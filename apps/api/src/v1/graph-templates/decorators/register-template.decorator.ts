import { SetMetadata } from '@nestjs/common';

export const REGISTER_TEMPLATE_KEY = 'registerTemplate';

/**
 * Decorator to automatically register a template with the TemplateRegistry
 */
export const RegisterTemplate = () => SetMetadata(REGISTER_TEMPLATE_KEY, true);
