import { mergePluginOptions } from '@nestjs/swagger/dist/plugin/merge-options.js';
import { isFilenameMatched } from '@nestjs/swagger/dist/plugin/utils/is-filename-matched.util.js';
import { ControllerClassVisitor } from '@nestjs/swagger/dist/plugin/visitors/controller-class.visitor.js';
import { ModelClassVisitor } from '@nestjs/swagger/dist/plugin/visitors/model-class.visitor.js';

const modelClassVisitor = new ModelClassVisitor();
const controllerClassVisitor = new ControllerClassVisitor();

export default function (program) {
  const options = mergePluginOptions({
    dtoFileNameSuffix: ['.dto.ts'],
    introspectComments: true,
  });

  const currentDir = program.getCurrentDirectory();

  return (ctx) => {
    return (sf) => {
      if (sf.fileName.startsWith(currentDir)) {
        if (isFilenameMatched(options.dtoFileNameSuffix, sf.fileName)) {
          // @ts-ignore
          return modelClassVisitor.visit(sf, ctx, program, options);
        }
        if (isFilenameMatched(options.controllerFileNameSuffix, sf.fileName)) {
          // @ts-ignore
          return controllerClassVisitor.visit(sf, ctx, program, options);
        }
      }

      return sf;
    };
  };
}
