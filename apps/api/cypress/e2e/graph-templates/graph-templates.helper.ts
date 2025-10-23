import { TemplateDto } from '../../api-definitions';
import { TemplateDtoSchema } from '../../api-definitions/schemas.gen';
import { reqHeaders } from '../common.helper';

export const getTemplates = (headers = reqHeaders) =>
  cy.request<TemplateDto[]>({
    url: '/api/v1/templates',
    method: 'GET',
    headers,
  });

export const validateTemplate = (data: TemplateDto) => {
  cy.validateSchema(data, TemplateDtoSchema);

  // Validate inputs structure if present
  if (data.inputs) {
    expect(data.inputs).to.be.an('array');
    data.inputs.forEach((input) => {
      expect(input).to.have.property('type');
      expect(input).to.have.property('value');
      expect(input).to.have.property('multiple');
      expect(input.type).to.be.oneOf(['kind', 'template']);
      expect(input.multiple).to.be.a('boolean');
    });
  }

  // Validate outputs structure if present
  if (data.outputs) {
    expect(data.outputs).to.be.an('array');
    data.outputs.forEach((output) => {
      expect(output).to.have.property('type');
      expect(output).to.have.property('value');
      expect(output).to.have.property('multiple');
      expect(output.type).to.be.oneOf(['kind', 'template']);
      expect(output.multiple).to.be.a('boolean');
    });
  }
};
