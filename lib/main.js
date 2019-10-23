"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
// TODO:
// * Check if the release has run update-dbs.ps1 (check if the environment is complete?)
// * Add dateDeployed - find the first release that ran db servicing and deployed the PR?
// * Switch to checking releases newer than the merge date?
const azdev = __importStar(require("azure-devops-node-api"));
const GitInterfaces_1 = require("azure-devops-node-api/interfaces/GitInterfaces");
const dotenv_1 = require("dotenv");
dotenv_1.config();
// your collection url
const orgUrl = "https://dev.azure.com/mseng";
const project = "AzureDevOps";
const releaseDefinitionId = 3358;
if (!process.env.AZURE_PERSONAL_ACCESS_TOKEN) {
    throw "AZURE_PERSONAL_ACCESS_TOKEN is undefined.";
}
let token = process.env.AZURE_PERSONAL_ACCESS_TOKEN;
let authHandler = azdev.getPersonalAccessTokenHandler(token);
let connection = new azdev.WebApi(orgUrl, authHandler);
function getDeployInfo(pullRequestId) {
    return __awaiter(this, void 0, void 0, function* () {
        let git = yield connection.getGitApi();
        let rm = yield connection.getReleaseApi();
        const pullRequest = yield git.getPullRequestById(pullRequestId);
        const prCommitId = pullRequest.lastMergeCommit.commitId;
        // console.log(pullRequest);
        // console.log();
        // console.log(pullRequest.status);
        let progressInfo = {
            pullRequest: {
                id: pullRequestId,
                status: pullRequest.status
            }
        };
        if (pullRequest.status != GitInterfaces_1.PullRequestStatus.Completed) {
            return progressInfo;
        }
        progressInfo.pullRequest.commitId = prCommitId;
        // console.log("Yup, completed.");
        // console.log(`Pull request commitId: ${prCommitId}`);
        const definition = yield rm.getReleaseDefinition(project, releaseDefinitionId);
        const environments = definition.environments;
        if (!environments) {
            throw "No environments defined!";
        }
        progressInfo.deployedEnvironments = [];
        for (const environment of environments) {
            if (environment.name === "Single Scale Unit") {
                continue;
            }
            if (!environment.currentRelease) {
                continue;
            }
            const currentRelease = yield rm.getRelease(project, environment.currentRelease.id);
            const currentBuild = currentRelease.artifacts[0].definitionReference;
            const currentCommitId = currentBuild.sourceVersion.id;
            const repositoryId = currentBuild.repository.id;
            // console.log(`Enviroment name: ${environment.name}`);
            // console.log(`Current release: ${currentRelease.id}`);
            // console.log(`Release status: ${currentRelease.status}`);
            // console.log(`CommitId: ${currentCommitId}`);
            // console.log();
            const mergeBases = yield git.getMergeBases(repositoryId, currentCommitId, prCommitId, project);
            for (const mergeBase of mergeBases) {
                if (mergeBase.commitId === prCommitId) {
                    const releaseEnv = currentRelease.environments.find(e => e.name === environment.name);
                    console.log(`${releaseEnv.name}: ${releaseEnv.status}`);
                    for (const deployStep of releaseEnv.deploySteps) {
                        console.log(`deployStep: ${deployStep.status}`);
                    }
                    console.log();
                    const env = {
                        name: environment.name,
                        currentCommitId: currentCommitId
                    };
                    progressInfo.deployedEnvironments.push(env);
                }
            }
        }
        return progressInfo;
    });
}
(function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(yield getDeployInfo(509638));
        console.log();
        console.log(yield getDeployInfo(510903));
        console.log();
        console.log(yield getDeployInfo(513131));
        console.log();
        console.log(yield getDeployInfo(513094));
        console.log();
    });
})();
