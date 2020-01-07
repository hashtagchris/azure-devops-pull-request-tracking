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
const ReleaseInterfaces_1 = require("azure-devops-node-api/interfaces/ReleaseInterfaces");
class PullRequestTracker {
    constructor(orgUrl, personalAccessToken, project, releaseDefinitionId, environmentsToIgnore) {
        this.project = project;
        this.releaseDefinitionId = releaseDefinitionId;
        this.authHandler = azdev.getPersonalAccessTokenHandler(personalAccessToken);
        this.connection = new azdev.WebApi(orgUrl, this.authHandler);
        this.environmentsToIgnore = environmentsToIgnore;
    }
    getEnvironmentNames() {
        return __awaiter(this, void 0, void 0, function* () {
            const rm = yield this.connection.getReleaseApi();
            const environments = yield this.getEnvironments(rm);
            return environments.map(env => env.name);
        });
    }
    getDeployInfos(pullRequestIds) {
        return __awaiter(this, void 0, void 0, function* () {
            const git = yield this.connection.getGitApi();
            const rm = yield this.connection.getReleaseApi();
            const pullRequestInfos = yield this.getPullRequestInfos(git, pullRequestIds);
            let deployInfos = pullRequestInfos.map(pullRequest => ({
                pullRequest,
                deployedToAllEnvironments: false,
            }));
            const completedPRs = deployInfos.filter(info => info.pullRequest.status === GitInterfaces_1.PullRequestStatus.Completed);
            if (!completedPRs.length) {
                return deployInfos;
            }
            const environments = yield this.getEnvironments(rm);
            const minCreationTime = this.min(completedPRs.map(info => info.pullRequest.completionTime));
            const top = 1000;
            const releases = yield rm.getReleases(this.project, this.releaseDefinitionId, undefined, undefined, undefined, ReleaseInterfaces_1.ReleaseStatus.Active, undefined, minCreationTime, undefined, ReleaseInterfaces_1.ReleaseQueryOrder.Ascending, top, undefined, ReleaseInterfaces_1.ReleaseExpands.Artifacts | ReleaseInterfaces_1.ReleaseExpands.Environments);
            for (const progressInfo of completedPRs) {
                progressInfo.deployedEnvironments = {};
                for (const release of releases) {
                    if (progressInfo.deployedToAllEnvironments) {
                        break;
                    }
                    if (!release.environments) {
                        throw "Release doesn't include environments";
                    }
                    const succeededEnvironments = release.environments.filter(e => this.environmentFilters(e));
                    if (!succeededEnvironments.length) {
                        continue;
                    }
                    // If the release was created before the PR was merged, we know it can't contain
                    // the PR's changes. We don't need to make the server call below.
                    if (release.createdOn < progressInfo.pullRequest.completionTime) {
                        continue;
                    }
                    if (!(yield this.releaseBuildIncludesCommit(git, release, progressInfo.pullRequest.commitId))) {
                        // console.log(`Release ${release.name} doesn't include PR !${progressInfo.pullRequest.id}`);
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
                            }
                        }
                    }
                }
            }
            return deployInfos;
        });
    }
    getPullRequestInfos(git, pullRequestIds) {
        return __awaiter(this, void 0, void 0, function* () {
            let pullRequestInfos = [];
            for (const pullRequestId of pullRequestIds) {
                const pullRequest = yield git.getPullRequestById(pullRequestId);
                const prCommitId = pullRequest.lastMergeCommit.commitId;
                // console.log(pullRequest);
                // console.log();
                // console.log(pullRequest.status);
                const pullRequestInfo = {
                    id: pullRequestId,
                    isDraft: pullRequest.isDraft,
                    status: pullRequest.status
                };
                if (pullRequest.status == GitInterfaces_1.PullRequestStatus.Completed) {
                    pullRequestInfo.completionTime = pullRequest.completionQueueTime;
                    pullRequestInfo.commitId = prCommitId;
                }
                pullRequestInfos.push(pullRequestInfo);
            }
            return pullRequestInfos;
        });
    }
    getEnvironments(rm) {
        return __awaiter(this, void 0, void 0, function* () {
            const definition = yield rm.getReleaseDefinition(this.project, this.releaseDefinitionId);
            if (!definition.environments) {
                throw "Release definition doesn't include environments";
            }
            return definition.environments.filter(env => this.environmentNameFilter(env));
        });
    }
    environmentNameFilter(environment) {
        return !this.environmentsToIgnore.includes(environment.name);
    }
    environmentStatusFilter(environment) {
        return environment.status === ReleaseInterfaces_1.EnvironmentStatus.Succeeded
            || environment.status === ReleaseInterfaces_1.EnvironmentStatus.PartiallySucceeded;
    }
    environmentFilters(environment) {
        return this.environmentNameFilter(environment) && this.environmentStatusFilter(environment);
    }
    releaseBuildIncludesCommit(git, release, commitId) {
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
            const mergeBases = yield git.getMergeBases(repositoryId, buildCommitId, commitId, this.project);
            for (const mergeBase of mergeBases) {
                if (mergeBase.commitId === commitId) {
                    return true;
                }
            }
            return false;
        });
    }
    min(values) {
        let minValue = undefined;
        for (const value of values) {
            if (minValue === undefined || minValue > value) {
                minValue = value;
            }
        }
        return minValue;
    }
}
exports.PullRequestTracker = PullRequestTracker;
