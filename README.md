This is an [AWS Lambda](https://aws.amazon.com/lambda/) function to monitor
services. It notifies about issues by publishing to an [Amazon
SNS](https://aws.amazon.com/sns/) topic. This means you can receive
notifications in several ways, including by email.

You give it a hostname and a port, and it attempts to connect to each IP
associated with the hostname. It establishes a TLS session and looks for the
greeting you define. If any of this fails, it reports the host/IP as down.

I wrote it to monitor for IRC server outages. In theory it will be usable for
any TLS-supporting service that sends a greeting to clients.


# Setup
  * Create an AWS account, an SNS topic (get its ARN), and an [execution
    role](http://docs.aws.amazon.com/lambda/latest/dg/with-sns-example-create-iam-role.html
    (get its ARN).
  * The Execution role should have these policies:
    * AWSLambdaBasicExecutionRole (to be able to log)
    * AmazonSNSFullAccess (to be able to publish to SNS) (you can be more fine
      grained than this policy, such as restricting to publishing only to a
      specific resource).
  * Copy `config.js.sample` to `config.js` and update the settings.
  * Make the deployment package zip file: `make`.
  * Create Lambda. You can do this in the AWS management console.
    * Select blank function (custom).
    * Make the trigger a CloudWatch Events - Schedule trigger.
    * Choose runtime Node.js 4.3
    * Set handler to `lambda-service-check.handler`.
    * Choose the role to be the execution role you created.
    * Upload zip file.
    * Set memory to 128 MB and timeout to 30 secs.


# Why AWS Lambda?
I want to schedule this Lambda function to run periodically, similarly to cron.
I found that [GCP Cloud Functions](https://cloud.google.com/functions/) are
have similaries to Lambda, there is no way currently to schedule functions.
