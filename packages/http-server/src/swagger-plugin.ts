import { mergePluginOptions } from '@nestjs/swagger/dist/plugin/merge-options';
import { isFilenameMatched } from '@nestjs/swagger/dist/plugin/utils/is-filename-matched.util';
import { ControllerClassVisitor } from '@nestjs/swagger/dist/plugin/visitors/controller-class.visitor';
import { ModelClassVisitor } from '@nestjs/swagger/dist/plugin/visitors/model-class.visitor';
import { Program } from 'typescript';
import * as ts from 'typescript';

const modelClassVisitor = new ModelClassVisitor();
const controllerClassVisitor = new ControllerClassVisitor();

export default function (program: Program): any {
  const options = mergePluginOptions({
    dtoFileNameSuffix: ['.dto.ts'],
    introspectComments: true,
  });

  const currentDir = program.getCurrentDirectory();

  return (ctx: ts.TransformationContext): ts.Transformer<any> => {
    return (sf: ts.SourceFile) => {
      if (sf.fileName.startsWith(currentDir)) {
        if (
          isFilenameMatched(<string[]>options.dtoFileNameSuffix, sf.fileName)
        ) {
          return modelClassVisitor.visit(sf, ctx, program, options);
        }
        if (
          isFilenameMatched(
            <string[]>options.controllerFileNameSuffix,
            sf.fileName,
          )
        ) {
          return controllerClassVisitor.visit(sf, ctx, program, options);
        }
      }

      return sf;
    };
  };
}
