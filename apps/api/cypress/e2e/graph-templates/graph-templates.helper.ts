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
};
