import ts from 'typescript';

// DevTools 2.02.2608040 emitted an unresolved SWC helper for array destructuring.
// Keep the client source independent of that helper without changing local config.
export function assertRuntimeSyntax(source,filename='runtime.ts') {
  const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
  function visit(node) {
    if(ts.isArrayBindingPattern(node)||(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isArrayLiteralExpression(node.left))) {
      const line=file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
      throw new Error(`${filename}:${line}: use indexed access instead of array destructuring; the installed DevTools SWC helper is unresolved.`);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
}
