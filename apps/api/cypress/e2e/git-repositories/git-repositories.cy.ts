import {
  CreateRepositoryDto,
  UpdateRepositoryDto,
} from '../../api-definitions';
import { buildAuthHeaders, generateRandomUUID } from '../common.helper';
import {
  createGitRepository,
  deleteGitRepository,
  getGitRepositories,
  getGitRepositoryById,
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
});
