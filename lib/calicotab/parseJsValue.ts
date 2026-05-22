import { parseExpressionAt, type Expression } from 'acorn';

/**
 * Parse a JavaScript expression literal — object, array, primitive — into a
 * plain JS value WITHOUT execution. Used as a fallback after JSON.parse for
 * the Tabbycat `window.vueData` payload, which embeds a JS object literal
 * (unquoted keys, occasional `undefined`/`Infinity` per d3c96de + da74b83)
 * rather than strict JSON.
 *
 * Replaces the previous `new Function('return ' + slice)()` eval. The acorn
 * AST walker is strictly limited to literal-shaped expressions: anything
 * involving function calls, member access, computed keys, template literals,
 * binary expressions, or arbitrary identifiers throws. There is no execution
 * context, no scope, no globals.
 *
 * Throws on parse failure, on input that contains non-literal expressions,
 * or on input that doesn't parse as a single expression. Callers should
 * catch and treat the throw as "couldn't parse" (matches the previous
 * evalJsLiteral try/catch contract in parseSlice).
 */
export function parseJsValue(slice: string): unknown {
  // parseExpressionAt parses the first expression starting at `pos` and
  // returns its AST. We feed the entire slice — the brace-counter
  // extractors in parseTabs.ts already trim to a single balanced
  // expression, so any trailing content is unexpected and we'd want
  // acorn to surface that as a parse error.
  const ast = parseExpressionAt(slice, 0, { ecmaVersion: 'latest' }) as Expression;
  return materialize(ast);
}

/**
 * Walk an acorn Expression AST and materialize it as a plain JS value.
 * Strict allowlist: only nodes that represent pure data are accepted.
 * Anything else throws — including constant-foldable shapes like `1 + 2`,
 * which is deliberately not accepted because the moment we accept any
 * expression evaluation we have to reason about edge cases (string
 * coercion, type juggling, etc.). Pure data only.
 */
function materialize(node: Expression): unknown {
  switch (node.type) {
    case 'Literal':
      // Covers numbers, strings, booleans, null, regex.
      return node.value;

    case 'ObjectExpression': {
      const obj: Record<string, unknown> = {};
      for (const prop of node.properties) {
        if (prop.type === 'SpreadElement') {
          throw new Error('spread elements are not supported');
        }
        // prop.type === 'Property' from here.
        if (prop.computed) {
          throw new Error('computed object keys are not supported');
        }
        let key: string;
        if (prop.key.type === 'Identifier') {
          key = prop.key.name;
        } else if (prop.key.type === 'Literal') {
          // String, number, or null literal keys. Coerce to string —
          // matches the JS semantics that `{1: 'x'}` and `{'1': 'x'}`
          // are the same object.
          key = String(prop.key.value);
        } else {
          throw new Error(`unsupported object key type: ${prop.key.type}`);
        }
        // Property.value is typed as Pattern | Expression in ESTree to
        // accommodate destructuring patterns. For object literals it's
        // always an Expression at runtime; if acorn somehow hands us a
        // Pattern, materialize will hit its default branch and throw.
        obj[key] = materialize(prop.value as Expression);
      }
      return obj;
    }

    case 'ArrayExpression':
      // Elided slots (`[1, , 3]`) come through as `null` from acorn — we
      // map them to `null` for clean downstream consumption. SpreadElement
      // is rejected.
      return node.elements.map((el) => {
        if (el === null) return null;
        if (el.type === 'SpreadElement') {
          throw new Error('spread elements are not supported');
        }
        return materialize(el);
      });

    case 'Identifier':
      // Only the three "magic" identifiers JS provides as global value
      // bindings are accepted. Anything else is presumed to be a reference
      // we can't resolve without executing — reject.
      if (node.name === 'undefined') return undefined;
      if (node.name === 'Infinity') return Infinity;
      if (node.name === 'NaN') return NaN;
      throw new Error(`unsupported identifier: ${node.name}`);

    case 'UnaryExpression': {
      // Allow `-` and `+` only — `-Infinity`, `-3.14`, `+5`. Other unary
      // operators (`!`, `~`, `typeof`, `void`, `delete`) involve runtime
      // semantics we don't want to materialize.
      if (node.operator !== '-' && node.operator !== '+') {
        throw new Error(`unsupported unary operator: ${node.operator}`);
      }
      const arg = materialize(node.argument);
      if (typeof arg !== 'number') {
        throw new Error(`unary ${node.operator} requires numeric argument`);
      }
      return node.operator === '-' ? -arg : +arg;
    }

    default:
      // Any AST node type not handled above is rejected. This includes
      // CallExpression, MemberExpression, TemplateLiteral, BinaryExpression,
      // LogicalExpression, ConditionalExpression, SpreadElement,
      // NewExpression, SequenceExpression, AssignmentExpression,
      // TaggedTemplateExpression, ClassExpression, YieldExpression,
      // AwaitExpression, ImportExpression, ArrowFunctionExpression,
      // FunctionExpression — anything that involves execution semantics
      // or references to scope.
      throw new Error(`unsupported expression type: ${node.type}`);
  }
}
