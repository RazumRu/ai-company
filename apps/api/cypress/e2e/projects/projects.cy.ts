import { buildAuthHeaders, generateRandomUUID, reqHeaders } from '../common.helper';
import {
  createProject,
  createTestProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  updateProject,
} from './projects.helper';

describe('Projects E2E', () => {
  const createdProjectIds: string[] = [];

  after(() => {
    cy.task('log', 'Cleaning up test projects...');
    createdProjectIds.forEach((id) => {
      deleteProject(id);
    });
  });

  describe('POST /v1/projects', () => {
    it('should create a project with required fields', () => {
      createProject({ name: 'My E2E Project' }).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('id');
        expect(response.body.name).to.equal('My E2E Project');
        expect(response.body).to.have.property('createdAt');
        expect(response.body).to.have.property('updatedAt');
        expect(response.body).to.have.property('createdBy');
        createdProjectIds.push(response.body.id);
      });
    });

    it('should create a project with all optional fields', () => {
      createProject({
        name: 'Full E2E Project',
        description: 'A complete project with all fields',
        icon: 'rocket',
        color: '#FF5733',
        settings: { theme: 'dark' },
      }).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body.name).to.equal('Full E2E Project');
        expect(response.body.description).to.equal(
          'A complete project with all fields',
        );
        expect(response.body.icon).to.equal('rocket');
        expect(response.body.color).to.equal('#FF5733');
        createdProjectIds.push(response.body.id);
      });
    });

    it('should return 403 when name is missing', () => {
      cy.request({
        url: '/api/v1/projects',
        method: 'POST',
        headers: reqHeaders,
        body: { description: 'No name provided' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.equal(403);
      });
    });

    it('should return 403 when name is empty string', () => {
      createProject({ name: '' }).then((response) => {
        expect(response.status).to.equal(403);
      });
    });

    it('should return 401 when called without auth headers', () => {
      cy.request({
        url: '/api/v1/projects',
        method: 'POST',
        body: { name: 'Unauthorized Project' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.equal(401);
      });
    });
  });

  describe('GET /v1/projects', () => {
    let projectId: string;

    before(() => {
      createTestProject().then((id) => {
        projectId = id;
        createdProjectIds.push(id);
      });
    });

    it('should return a list of projects', () => {
      getAllProjects().then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.be.an('array');
      });
    });

    it('should return only the calling user\'s projects', () => {
      const otherUserHeaders = buildAuthHeaders({
        userId: generateRandomUUID(),
      });

      createProject(
        {
          name: `Other User Project ${generateRandomUUID().slice(0, 8)}`,
        },
        otherUserHeaders,
      ).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const otherUsersProjectId = createResponse.body.id;

        getAllProjects().then((listResponse) => {
          expect(listResponse.status).to.equal(200);
          const ids = listResponse.body.map((p) => p.id);
          expect(ids).to.not.include(otherUsersProjectId);

          // Cleanup other user's project
          deleteProject(otherUsersProjectId, otherUserHeaders);
        });
      });
    });

    it('should include the project created in before()', () => {
      getAllProjects().then((response) => {
        expect(response.status).to.equal(200);
        const ids = response.body.map((p) => p.id);
        expect(ids).to.include(projectId);
      });
    });
  });

  describe('GET /v1/projects/:id', () => {
    let projectId: string;

    before(() => {
      createTestProject().then((id) => {
        projectId = id;
        createdProjectIds.push(id);
      });
    });

    it('should return the project by id', () => {
      getProjectById(projectId).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body.id).to.equal(projectId);
        expect(response.body).to.have.property('name');
        expect(response.body).to.have.property('createdAt');
      });
    });

    it('should return 404 for a non-existent project', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      getProjectById(nonExistentId).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 404 for another user\'s project', () => {
      const otherUserHeaders = buildAuthHeaders({
        userId: generateRandomUUID(),
      });

      getProjectById(projectId, otherUserHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });
  });

  describe('PUT /v1/projects/:id', () => {
    let projectId: string;

    before(() => {
      createTestProject().then((id) => {
        projectId = id;
        createdProjectIds.push(id);
      });
    });

    it('should update the project name', () => {
      updateProject(projectId, { name: 'Updated Project Name' }).then(
        (response) => {
          expect(response.status).to.equal(200);
          expect(response.body.id).to.equal(projectId);
          expect(response.body.name).to.equal('Updated Project Name');
        },
      );
    });

    it('should update description', () => {
      updateProject(projectId, { description: 'New description' }).then(
        (response) => {
          expect(response.status).to.equal(200);
          expect(response.body.description).to.equal('New description');
        },
      );
    });

    it('should update color and icon', () => {
      updateProject(projectId, {
        color: '#00FF00',
        icon: 'star',
      }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body.color).to.equal('#00FF00');
        expect(response.body.icon).to.equal('star');
      });
    });

    it('should return 404 for a non-existent project', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      updateProject(nonExistentId, { name: 'Ghost' }).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 404 when updating another user\'s project', () => {
      const otherUserHeaders = buildAuthHeaders({
        userId: generateRandomUUID(),
      });

      updateProject(projectId, { name: 'Hijacked' }, otherUserHeaders).then(
        (response) => {
          expect(response.status).to.equal(404);
        },
      );
    });
  });

  describe('DELETE /v1/projects/:id', () => {
    it('should delete the project and return 404 on subsequent get', () => {
      createTestProject().then((id) => {
        deleteProject(id).then((response) => {
          expect(response.status).to.equal(204);

          getProjectById(id).then((getResponse) => {
            expect(getResponse.status).to.equal(404);
          });
        });
      });
    });

    it('should return 404 when deleting a non-existent project', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      deleteProject(nonExistentId).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 404 when deleting another user\'s project', () => {
      const otherUserHeaders = buildAuthHeaders({
        userId: generateRandomUUID(),
      });

      createTestProject().then((id) => {
        createdProjectIds.push(id);

        deleteProject(id, otherUserHeaders).then((response) => {
          expect(response.status).to.equal(404);
        });
      });
    });
  });
});
