import * as cdk from 'aws-cdk-lib/core';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as path from 'path';

const TEXT_MODEL_ID = 'openai.gpt-oss-120b';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const agentCoreRuntimeArn = new cdk.CfnParameter(this, 'AgentCoreRuntimeArn', {
      type: 'String',
      description: 'ARN of the AgentCore voice relay runtime for hosted browser sessions',
    });

    const hostedFrontendOrigin = new cdk.CfnParameter(this, 'HostedFrontendOrigin', {
      type: 'String',
      description: 'HTTPS origin allowed to call the hosted public endpoints',
      allowedPattern: 'https://.+',
    });
    const costAlertEmail = new cdk.CfnParameter(this, 'CostAlertEmail', {
      type: 'String',
      description: 'Email address that receives application usage and budget alerts',
    });
    const monthlyBudgetUsd = new cdk.CfnParameter(this, 'MonthlyBudgetUsd', {
      type: 'Number',
      default: 25,
      minValue: 1,
      description: 'Monthly AWS account budget in USD',
    });
    const hostedDailyInterviewLimit = new cdk.CfnParameter(
      this,
      'HostedDailyInterviewLimit',
      {
        type: 'Number',
        default: 100,
        minValue: 1,
        maxValue: 100,
        description: 'Maximum hosted interview sessions admitted per UTC day',
      }
    );
    const hostedDailyViewerLimit = new cdk.CfnParameter(
      this,
      'HostedDailyViewerLimit',
      {
        type: 'Number',
        default: 100,
        minValue: 1,
        maxValue: 100,
        description: 'Maximum hosted interview sessions admitted per viewer IP per UTC day',
      }
    );
    const publicEndpointsEnabled = new cdk.CfnParameter(this, 'PublicEndpointsEnabled', {
      type: 'String',
      default: 'true',
      allowedValues: ['true', 'false'],
      description: 'Emergency switch; false sets hosted Lambda concurrency to zero',
    });
    const endpointsEnabled = new cdk.CfnCondition(this, 'PublicEndpointsEnabledCondition', {
      expression: cdk.Fn.conditionEquals(publicEndpointsEnabled.valueAsString, 'true'),
    });
    const hostedConcurrencyCapsEnabled = new cdk.CfnParameter(
      this,
      'HostedConcurrencyCapsEnabled',
      {
        type: 'String',
        default: 'false',
        allowedValues: ['true', 'false'],
        description: 'Enable nonzero per-function concurrency caps after the account quota supports them',
      }
    );
    const concurrencyCapsEnabled = new cdk.CfnCondition(
      this,
      'HostedConcurrencyCapsEnabledCondition',
      {
        expression: cdk.Fn.conditionEquals(hostedConcurrencyCapsEnabled.valueAsString, 'true'),
      }
    );

    // ------------------------------------------------------------------
    // S3 Bucket — interview structure + interview profile configs
    // ------------------------------------------------------------------
    const configBucket = new s3.Bucket(this, 'InterviewConfigBucket', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    new s3deploy.BucketDeployment(this, 'InterviewConfigDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../backend/config'))],
      destinationBucket: configBucket,
    });

    // ------------------------------------------------------------------
    // Shared CORS options for private Function URLs. CloudFront is the only
    // AWS principal allowed to invoke them; browsers call the distribution.
    // ------------------------------------------------------------------
    const corsOptions: lambda.FunctionUrlCorsOptions = {
      allowedOrigins: [hostedFrontendOrigin.valueAsString, 'http://localhost:5173'],
      allowedMethods: [lambda.HttpMethod.POST],
      allowedHeaders: ['Content-Type', 'x-amz-content-sha256'],
    };

    const functionAssetExcludes = [
      '.env*',
      '__pycache__',
      '**/__pycache__',
      '*.pyc',
      '**/*.pyc',
      'tests',
      'tests/**',
      'test_event.json',
    ];

    const sessionTable = new dynamodb.Table(this, 'HostedInterviewSessions', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const sessionGuardLayer = new lambda.LayerVersion(this, 'SessionGuardLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/shared')),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Hosted interview admission and per-stage attempt guard',
    });
    const hostedSessionEnvironment = {
      HOSTED_GUARDRAILS_ENABLED: 'true',
      HOSTED_SESSION_TABLE: sessionTable.tableName,
      HOSTED_DAILY_INTERVIEW_LIMIT: hostedDailyInterviewLimit.valueAsString,
      HOSTED_DAILY_VIEWER_LIMIT: hostedDailyViewerLimit.valueAsString,
    };

    // ------------------------------------------------------------------
    // 1. Analyst Lambda — Bedrock Mantle (gpt-oss-120b)
    // ------------------------------------------------------------------
    const analystFn = new lambda.Function(this, 'AnalystFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/functions/analyst'),
        { exclude: functionAssetExcludes }
      ),
      handler: 'handler.lambda_handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: hostedSessionEnvironment,
      layers: [sessionGuardLayer],
    });

    const grantMantleInference = (fn: lambda.Function) => {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['bedrock-mantle:CreateInference'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'bedrock-mantle:Model': TEXT_MODEL_ID },
          },
        })
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'bedrock-mantle:GetProject',
            'bedrock-mantle:ListProjects',
            'bedrock-mantle:ListTagsForResource',
          ],
          resources: ['*'],
        })
      );
    };

    grantMantleInference(analystFn);

    const analystUrl = analystFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // 2. Evaluator Lambda — Bedrock Mantle (gpt-oss-120b)
    // ------------------------------------------------------------------
    const evaluatorFn = new lambda.Function(this, 'EvaluatorFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/functions/evaluator'),
        {
          exclude: [
            ...functionAssetExcludes,
            'README.md',
            'samconfig.toml',
            'template.yaml',
          ],
        }
      ),
      handler: 'lambda_handler.handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: hostedSessionEnvironment,
      layers: [sessionGuardLayer],
    });

    grantMantleInference(evaluatorFn);

    const evaluatorUrl = evaluatorFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // 3. Interviewer Lambda — context builder (S3 read, no LLM)
    // ------------------------------------------------------------------
    const interviewerFn = new lambda.Function(this, 'InterviewerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/functions/interviewer'),
        { exclude: functionAssetExcludes }
      ),
      handler: 'handler.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ...hostedSessionEnvironment,
        S3_BUCKET: configBucket.bucketName,
        INTERVIEW_STRUCTURE_KEY: 'interview_structure.json',
        INTERVIEW_PROFILE_KEY: 'student_interview_profile.json',
      },
      layers: [sessionGuardLayer],
    });

    configBucket.grantRead(interviewerFn);

    const interviewerUrl = interviewerFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // 4. PDF Parser Lambda — pypdf (bundled via Docker)
    // ------------------------------------------------------------------
    const pdfParserFn = new lambda.Function(this, 'PdfParserFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/functions/pdf_parser'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'pip install --no-compile pypdf -t /asset-output && cp ./*.py /asset-output',
          ],
        },
      }),
      handler: 'handler.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: hostedSessionEnvironment,
      layers: [sessionGuardLayer],
    });

    const pdfParserUrl = pdfParserFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // 5. Voice session Lambda — short-lived AgentCore WebSocket URLs
    // ------------------------------------------------------------------
    const voiceSessionFn = new lambda.Function(this, 'VoiceSessionFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/functions/voice_session'),
        { exclude: functionAssetExcludes }
      ),
      handler: 'handler.lambda_handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        ...hostedSessionEnvironment,
        AGENTCORE_RUNTIME_ARN: agentCoreRuntimeArn.valueAsString,
      },
      layers: [sessionGuardLayer],
    });

    voiceSessionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream'],
        resources: [
          agentCoreRuntimeArn.valueAsString,
          `${agentCoreRuntimeArn.valueAsString}/runtime-endpoint/*`,
        ],
      })
    );

    const voiceSessionUrl = voiceSessionFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // 6. Demo session Lambda — daily admission + opaque session tokens
    // ------------------------------------------------------------------
    const demoSessionFn = new lambda.Function(this, 'DemoSessionFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/functions/demo_session'),
        { exclude: functionAssetExcludes }
      ),
      handler: 'handler.lambda_handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: hostedSessionEnvironment,
      layers: [sessionGuardLayer],
    });

    sessionTable.grant(
      demoSessionFn,
      'dynamodb:TransactWriteItems',
      'dynamodb:UpdateItem',
      'dynamodb:PutItem',
      'dynamodb:GetItem'
    );
    for (const fn of [
      analystFn,
      evaluatorFn,
      interviewerFn,
      pdfParserFn,
      voiceSessionFn,
    ]) {
      sessionTable.grant(fn, 'dynamodb:UpdateItem', 'dynamodb:GetItem');
    }

    const demoSessionUrl = demoSessionFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: corsOptions,
    });

    // ------------------------------------------------------------------
    // Public API gateway — CloudFront signs private Function URL requests
    // ------------------------------------------------------------------
    const apiOriginAccessControl = new cloudfront.FunctionUrlOriginAccessControl(
      this,
      'ApiFunctionUrlOriginAccessControl'
    );
    const functionUrlOrigin = (url: lambda.FunctionUrl) =>
      origins.FunctionUrlOrigin.withOriginAccessControl(url, {
        originAccessControl: apiOriginAccessControl,
        // gpt-oss-120b requests are capped at 55 seconds; allow a small margin for
        // Lambda response handling without requiring a CloudFront quota raise.
        readTimeout: cdk.Duration.seconds(60),
      });
    const apiRequestGuard = new cloudfront.Function(this, 'HostedApiRequestGuard', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var allowedPaths = {
    '/session': true,
    '/pdf-parser': true,
    '/analyst': true,
    '/interviewer': true,
    '/evaluator': true,
    '/voice-session': true
  };
  if (!allowedPaths[request.uri]) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (request.method !== 'POST' && request.method !== 'OPTIONS') {
    return { statusCode: 405, statusDescription: 'Method Not Allowed' };
  }
  return request;
}
      `),
      comment: 'Reject unknown hosted API paths and non-POST requests at the edge',
    });
    const apiBehavior = (origin: cloudfront.IOrigin): cloudfront.BehaviorOptions => ({
      origin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      functionAssociations: [{
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        function: apiRequestGuard,
      }],
    });

    const apiDistribution = new cloudfront.Distribution(this, 'HostedApiDistribution', {
      defaultBehavior: apiBehavior(functionUrlOrigin(pdfParserUrl)),
      additionalBehaviors: {
        session: apiBehavior(functionUrlOrigin(demoSessionUrl)),
        analyst: apiBehavior(functionUrlOrigin(analystUrl)),
        interviewer: apiBehavior(functionUrlOrigin(interviewerUrl)),
        evaluator: apiBehavior(functionUrlOrigin(evaluatorUrl)),
        'voice-session': apiBehavior(functionUrlOrigin(voiceSessionUrl)),
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: 'Signed gateway for private Mock Interview Coach Function URLs',
    });

    // Lambda requires both permissions for new AWS_IAM Function URLs. The OAC
    // origin supplies InvokeFunctionUrl; this explicit permission supplies the
    // additional InvokeFunction authorization, scoped to this distribution.
    for (const [id, fn] of [
      ['Analyst', analystFn],
      ['Evaluator', evaluatorFn],
      ['Interviewer', interviewerFn],
      ['PdfParser', pdfParserFn],
      ['VoiceSession', voiceSessionFn],
      ['DemoSession', demoSessionFn],
    ] as const) {
      new lambda.CfnPermission(this, `${id}CloudFrontInvokeFunctionPermission`, {
        action: 'lambda:InvokeFunction',
        functionName: fn.functionName,
        principal: 'cloudfront.amazonaws.com',
        sourceArn: apiDistribution.distributionArn,
        invokedViaFunctionUrl: true,
      });
    }

    // ------------------------------------------------------------------
    // Hosted endpoint guardrails and cost notifications
    // ------------------------------------------------------------------
    const applyEmergencySwitch = (fn: lambda.Function, enabledConcurrency: number) => {
      const resource = fn.node.defaultChild as lambda.CfnFunction;
      resource.addPropertyOverride(
        'ReservedConcurrentExecutions',
        cdk.Fn.conditionIf(
          endpointsEnabled.logicalId,
          cdk.Fn.conditionIf(
            concurrencyCapsEnabled.logicalId,
            enabledConcurrency,
            cdk.Aws.NO_VALUE
          ),
          0
        )
      );
    };
    applyEmergencySwitch(analystFn, 2);
    applyEmergencySwitch(evaluatorFn, 2);
    applyEmergencySwitch(interviewerFn, 4);
    applyEmergencySwitch(pdfParserFn, 4);
    applyEmergencySwitch(voiceSessionFn, 2);
    applyEmergencySwitch(demoSessionFn, 2);

    const alertTopic = new sns.Topic(this, 'CostAndUsageAlerts', {
      displayName: 'Mock Interview Coach cost and usage alerts',
    });
    alertTopic.addSubscription(new subscriptions.EmailSubscription(costAlertEmail.valueAsString));
    alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
        conditions: {
          StringEquals: { 'aws:SourceAccount': cdk.Aws.ACCOUNT_ID },
          ArnLike: {
            'aws:SourceArn': `arn:${cdk.Aws.PARTITION}:budgets::${cdk.Aws.ACCOUNT_ID}:*`,
          },
        },
      })
    );

    const addFunctionAlarms = (
      id: string,
      fn: lambda.Function,
      invocationThreshold: number
    ) => {
      const invocationAlarm = new cloudwatch.Alarm(this, `${id}HighInvocations`, {
        metric: fn.metricInvocations({ period: cdk.Duration.minutes(5) }),
        threshold: invocationThreshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      invocationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

      const errorAlarm = new cloudwatch.Alarm(this, `${id}Errors`, {
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 3,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

      const throttleAlarm = new cloudwatch.Alarm(this, `${id}Throttles`, {
        metric: fn.metricThrottles({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
    };
    addFunctionAlarms('Analyst', analystFn, 10);
    addFunctionAlarms('Evaluator', evaluatorFn, 10);
    addFunctionAlarms('Interviewer', interviewerFn, 25);
    addFunctionAlarms('PdfParser', pdfParserFn, 25);
    addFunctionAlarms('VoiceSession', voiceSessionFn, 10);
    addFunctionAlarms('DemoSession', demoSessionFn, 25);

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: 'MockInterviewCoachMonthlyCost',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyBudgetUsd.valueAsNumber,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
        notification: {
          comparisonOperator: 'GREATER_THAN',
          notificationType: 'ACTUAL',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{
          address: alertTopic.topicArn,
          subscriptionType: 'SNS',
        }],
      })),
    });

    // ------------------------------------------------------------------
    // Outputs — hosted frontend configuration. Raw Function URLs are private
    // implementation details and are intentionally not exported.
    // ------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: `https://${apiDistribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, 'ConfigBucketName', { value: configBucket.bucketName });
    new cdk.CfnOutput(this, 'CostAlertsTopicArn', { value: alertTopic.topicArn });
  }
}
