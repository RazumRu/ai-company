import { getTemplates, validateTemplate } from './graph-templates.helper';

describe('Graph Templates E2E', () => {
  describe('GET /v1/templates', () => {
    it('should get all templates', () => {
      getTemplates().then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.a('array');

        for (const item of response.body) {
          validateTemplate(item);
        }
      });
    });
  });
});
