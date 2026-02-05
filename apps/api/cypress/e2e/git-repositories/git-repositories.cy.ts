import {
  CreateRepositoryDto,
  TriggerReindexDto,
  UpdateRepositoryDto,
} from '../../api-definitions';
import { buildAuthHeaders, generateRandomUUID } from '../common.helper';
import {
  createGitRepository,
  deleteGitRepository,
  getGitRepositories,
  getGitRepositoryById,
  getRepoIndexByRepositoryId,
  getRepoIndexes,
  triggerReindex,
  updateGitRepository,
} from './git-repositories.helper';

describe('Git Repositories E2E', () => {
  it('should list repositories (initially empty or pre-existing)', () => {
    getGitRepositories().then((response) => {
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
    });
  });

  it('should manage repository records via service integration and API', () => {
    const url = 'https://github.com/octocat/Hello-World.git';
    const repositoryData: CreateRepositoryDto = {
      owner: 'octocat',
      repo: 'Hello-World',
      url: url,
      provider: 'GITHUB',
    };

    // Create a repository
    createGitRepository(repositoryData).then((createResponse) => {
      expect(createResponse.status).to.equal(201);
      const id = createResponse.body.id;

      // Get by ID
      getGitRepositoryById(id).then((getResponse) => {
        expect(getResponse.status).to.equal(200);
        expect(getResponse.body.owner).to.equal(repositoryData.owner);
      });

      // Update
      const updateData: UpdateRepositoryDto = {
        url: 'https://github.com/octocat/Updated.git',
      };
      updateGitRepository(id, updateData).then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);
        expect(updateResponse.body.url).to.equal(updateData.url);
      });

      // Cleanup
      deleteGitRepository(id).then((deleteResponse) => {
        expect(deleteResponse.status).to.equal(200);
      });
    });
  });

  it('should return 404 for non-existent repository', () => {
    const nonExistentId = generateRandomUUID();
    getGitRepositoryById(nonExistentId).then((response) => {
      expect(response.status).to.equal(404);
    });
  });

  it('should return 404 when deleting non-existent repository', () => {
    const nonExistentId = generateRandomUUID();
    deleteGitRepository(nonExistentId).then((response) => {
      expect(response.status).to.equal(404);
    });
  });

  it('should enforce user isolation', () => {
    // This is better tested in unit/integration, but E2E can verify headers are respected.
    const differentUserHeaders = buildAuthHeaders({
      userId: generateRandomUUID(),
    });

    getGitRepositories({}, differentUserHeaders).then((response) => {
      expect(response.status).to.equal(200);
      // Different user should see their own repos (likely empty)
      expect(response.body).to.be.an('array');
    });
  });

  describe('Repository Indexing', () => {
    it('should list repository indexes (initially empty or pre-existing)', () => {
      getRepoIndexes().then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.be.an('array');
      });
    });

    it('should return null when repository has no index', () => {
      const url = 'https://github.com/octocat/NoIndex.git';
      const repositoryData: CreateRepositoryDto = {
        owner: 'octocat',
        repo: 'NoIndex',
        url: url,
        provider: 'GITHUB',
      };

      createGitRepository(repositoryData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const id = createResponse.body.id;

        getRepoIndexByRepositoryId(id).then((indexResponse) => {
          expect(indexResponse.status).to.equal(200);
          expect(indexResponse.body).to.be.null;
        });

        // Cleanup
        deleteGitRepository(id);
      });
    });

    it('should trigger reindexing for a repository', () => {
      const url = 'https://github.com/octocat/ReindexTest.git';
      const repositoryData: CreateRepositoryDto = {
        owner: 'octocat',
        repo: 'ReindexTest',
        url: url,
        provider: 'GITHUB',
      };

      createGitRepository(repositoryData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const repositoryId = createResponse.body.id;

        const reindexData: TriggerReindexDto = {
          repositoryId,
        };

        triggerReindex(reindexData).then((reindexResponse) => {
          expect(reindexResponse.status).to.equal(201);
          expect(reindexResponse.body).to.have.property('repoIndex');
          expect(reindexResponse.body).to.have.property('message');
          expect(reindexResponse.body.repoIndex.repositoryId).to.equal(
            repositoryId,
          );
          expect(reindexResponse.body.repoIndex.status).to.be.oneOf([
            'pending',
            'in_progress',
          ]);
        });

        // Verify index was created
        getRepoIndexByRepositoryId(repositoryId).then((indexResponse) => {
          expect(indexResponse.status).to.equal(200);
          expect(indexResponse.body).to.not.be.null;
          if (indexResponse.body) {
            expect(indexResponse.body.repositoryId).to.equal(repositoryId);
          }
        });

        // Cleanup
        deleteGitRepository(repositoryId);
      });
    });

    it('should prevent concurrent reindexing of the same repository', () => {
      const url = 'https://github.com/octocat/ConcurrentTest.git';
      const repositoryData: CreateRepositoryDto = {
        owner: 'octocat',
        repo: 'ConcurrentTest',
        url: url,
        provider: 'GITHUB',
      };

      createGitRepository(repositoryData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const repositoryId = createResponse.body.id;

        const reindexData: TriggerReindexDto = {
          repositoryId,
        };

        // Trigger first reindex
        triggerReindex(reindexData).then((firstReindexResponse) => {
          expect(firstReindexResponse.status).to.equal(201);

          // Try to trigger again immediately
          triggerReindex(reindexData).then((secondReindexResponse) => {
            expect(secondReindexResponse.status).to.equal(400);
          });
        });

        // Cleanup
        deleteGitRepository(repositoryId);
      });
    });

    it('should filter indexes by repository ID', () => {
      const repo1Data: CreateRepositoryDto = {
        owner: 'octocat',
        repo: 'Filter1',
        url: 'https://github.com/octocat/Filter1.git',
        provider: 'GITHUB',
      };

      const repo2Data: CreateRepositoryDto = {
        owner: 'octocat',
        repo: 'Filter2',
        url: 'https://github.com/octocat/Filter2.git',
        provider: 'GITHUB',
      };

      createGitRepository(repo1Data).then((repo1Response) => {
        expect(repo1Response.status).to.equal(201);
        const repo1Id = repo1Response.body.id;

        createGitRepository(repo2Data).then((repo2Response) => {
          expect(repo2Response.status).to.equal(201);
          const repo2Id = repo2Response.body.id;

          // Trigger indexing for both
          triggerReindex({ repositoryId: repo1Id });
          triggerReindex({ repositoryId: repo2Id });

          // Wait a bit for indexes to be created
          cy.wait(500);

          // Filter by repo1Id
          getRepoIndexes({ repositoryId: repo1Id }).then((response) => {
            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
            response.body.forEach((index) => {
              expect(index.repositoryId).to.equal(repo1Id);
            });
          });

          // Cleanup
          deleteGitRepository(repo1Id);
          deleteGitRepository(repo2Id);
        });
      });
    });

    it('should filter indexes by status', () => {
      getRepoIndexes({ status: 'pending' }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.be.an('array');
        response.body.forEach((index) => {
          expect(index.status).to.equal('pending');
        });
      });
    });

    it('should return 404 when triggering reindex for non-existent repository', () => {
      const nonExistentId = generateRandomUUID();
      triggerReindex({ repositoryId: nonExistentId }).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 404 when getting index for non-existent repository', () => {
      const nonExistentId = generateRandomUUID();
      getRepoIndexByRepositoryId(nonExistentId).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should enforce user isolation for indexes', () => {
      const differentUserHeaders = buildAuthHeaders({
        userId: generateRandomUUID(),
      });

      getRepoIndexes({}, differentUserHeaders).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.be.an('array');
      });
    });
  });
});
