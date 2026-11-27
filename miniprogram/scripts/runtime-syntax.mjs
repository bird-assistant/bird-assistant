import ts from 'typescript';

// DevTools 2.02.2608040 emitted an unresolved SWC helper for array destructuring.
// Keep the client source independent of that helper without changing local config.
export function assertRuntimeSyntax(source,filename='runtime.ts') {
  const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
  function plainInitialValue(node) {
    if(ts.isFunctionLike(node))return;
    if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&['Map','Set','WeakMap','WeakSet'].includes(node.expression.text)){
      const line=file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
      throw new Error(`${filename}:${line}: non-plain Page/Component data cannot be cloned by WeChat; initialize collections in a lifecycle method or a module-scoped WeakMap.`);
    }
    ts.forEachChild(node,plainInitialValue);
  }
  function visit(node) {
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['Page','Component'].includes(node.expression.text)){
      const definition=node.arguments[0];
      if(definition&&ts.isObjectLiteralExpression(definition))for(const property of definition.properties)if(ts.isPropertyAssignment(property))plainInitialValue(property.initializer);
    }
    if(ts.isArrayBindingPattern(node)||(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&ts.isArrayLiteralExpression(node.left))) {
      const line=file.getLineAndCharacterOfPosition(node.getStart(file)).line+1;
      throw new Error(`${filename}:${line}: use indexed access instead of array destructuring; the installed DevTools SWC helper is unresolved.`);
    }
    ts.forEachChild(node,visit);
  }
  visit(file);
}
