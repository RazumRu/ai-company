import { getModels } from './litellm.helper';

describe('Models API', () => {
  it('GET /api/v1/litellm/models returns LiteLLM model list', () => {
    getModels().then((response) => {
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array').and.not.be.empty;

      response.body.forEach((model) => {
        expect(model.id).to.be.a('string').and.not.be.empty;
        expect(model.ownedBy).to.be.a('string').and.not.be.empty;
      });
    });
  });
});
