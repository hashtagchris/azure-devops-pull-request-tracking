# azure-devops-pull-request-tracking
Retrieve the deployed environments for an Azure Repos' pull request

## Sample usage

```
(async function main() {
  const orgUrl = "https://dev.azure.com/myOrg";
  const project = "myProject";
  const releaseDefinitionId = 42;
  const environmentsToIgnore = ["sandbox"];

  // Read your AZURE_PERSONAL_ACCESS_TOKEN from .env
  require("dotenv").config();

  if (!process.env.AZURE_PERSONAL_ACCESS_TOKEN) {
    throw "AZURE_PERSONAL_ACCESS_TOKEN is undefined.";
  }
  let token: string = process.env.AZURE_PERSONAL_ACCESS_TOKEN;

  const tracker = new PullRequestTracker(orgUrl, token, project, releaseDefinitionId, environmentsToIgnore);

  console.log(await tracker.getDeployInfos([494919]));
  console.log();

  console.log(await tracker.getDeployInfos([510903]));
  console.log();

  console.log(await tracker.getDeployInfos([513131, 513094]));
  console.log();
})();
```
