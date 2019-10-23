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
// * Add dateDeployed - find the first release that ran db servicing and deployed the PR?
const azdev = __importStar(require("azure-devops-node-api"));
const GitInterfaces_1 = require("azure-devops-node-api/interfaces/GitInterfaces");
const dotenv_1 = require("dotenv");
const ReleaseInterfaces_1 = require("azure-devops-node-api/interfaces/ReleaseInterfaces");
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
                isDraft: pullRequest.isDraft,
                status: pullRequest.status
            },
            deployedToAllEnvironments: false
        };
        if (pullRequest.status != GitInterfaces_1.PullRequestStatus.Completed) {
            return progressInfo;
        }
        progressInfo.pullRequest.completionTime = pullRequest.completionQueueTime;
        progressInfo.pullRequest.commitId = prCommitId;
        const environments = yield getEnvironments(rm);
        const minCreationTime = progressInfo.pullRequest.completionTime;
        const top = 1000;
        const releases = yield rm.getReleases(project, releaseDefinitionId, undefined, undefined, undefined, ReleaseInterfaces_1.ReleaseStatus.Active, undefined, minCreationTime, undefined, ReleaseInterfaces_1.ReleaseQueryOrder.Ascending, top, undefined, ReleaseInterfaces_1.ReleaseExpands.Artifacts | ReleaseInterfaces_1.ReleaseExpands.Environments);
        progressInfo.deployedEnvironments = {};
        for (const release of releases) {
            if (!release.environments) {
                throw "Release doesn't include environments";
            }
            const succeededEnvironments = release.environments.filter(environmentFilters);
            if (!succeededEnvironments.length) {
                continue;
            }
            if (!(yield releaseBuildIncludesCommit(git, release, prCommitId))) {
                console.log(`Release ${release.name} doesn't include PR !${pullRequestId}`);
                continue;
            }
            for (const environment of succeededEnvironments) {
                // console.log(`Release ${release.name}, environment ${environment.name}`);
                if (!progressInfo.deployedEnvironments[environment.name]) {
                    progressInfo.deployedEnvironments[environment.name] = {
                        name: environment.name,
                        firstReleaseName: release.name
                    };
                    if (Object.keys(progressInfo.deployedEnvironments).length === environments.length) {
                        progressInfo.deployedToAllEnvironments = true;
                        return progressInfo;
                    }
                }
            }
        }
        return progressInfo;
    });
}
function getEnvironments(rm) {
    return __awaiter(this, void 0, void 0, function* () {
        const definition = yield rm.getReleaseDefinition(project, releaseDefinitionId);
        if (!definition.environments) {
            throw "Release definition doesn't include environments";
        }
        return definition.environments.filter(environmentNameFilter);
    });
}
function environmentNameFilter(environment) {
    return environment.name !== "Single Scale Unit";
    // const result = environment.name != "Single Scale Unit";
    // console.log(`${environment.name}: ${result}`);
    // return result;
}
function environmentStatusFilter(environment) {
    return environment.status === ReleaseInterfaces_1.EnvironmentStatus.Succeeded
        || environment.status === ReleaseInterfaces_1.EnvironmentStatus.PartiallySucceeded;
}
function environmentFilters(environment) {
    return environmentNameFilter(environment) && environmentStatusFilter(environment);
}
function releaseBuildIncludesCommit(git, release, commitId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!release.artifacts) {
            console.log("Release doesn't include artifacts");
            throw "Release doesn't include artifacts.";
        }
        const build = release.artifacts[0].definitionReference;
        const buildCommitId = build.sourceVersion.id;
        const repositoryId = build.repository.id;
        if (buildCommitId === commitId) {
            return true;
        }
        // console.log(`Checking merge base for ${buildCommitId} and ${commitId}...`);
        const mergeBases = yield git.getMergeBases(repositoryId, buildCommitId, commitId, project);
        for (const mergeBase of mergeBases) {
            if (mergeBase.commitId === commitId) {
                return true;
            }
        }
        return false;
    });
}
(function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(yield getDeployInfo(494919));
        console.log();
        console.log(yield getDeployInfo(510903));
        console.log();
        console.log(yield getDeployInfo(513131));
        console.log();
        console.log(yield getDeployInfo(513094));
        console.log();
    });
})();
