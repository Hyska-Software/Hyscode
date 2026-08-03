// SpectraLang snippets registered as Monaco completion items.
// Converted from the SpectraLang official VSCode snippets
// (tools/vscode-extension/snippets/spectra.code-snippets of the SpectraLang repo).

export interface MonacoSnippet {
  label: string;
  detail: string;
  insertText: string;
  kind: number; // CompletionItemKind
}

export const SPECTRA_SNIPPETS: MonacoSnippet[] = [
  {
    label: 'module',
    detail: 'Declare a Spectra module',
    insertText: ['module ${1:name};', '', '${0}'].join('\n'),
    kind: 15,
  },
  {
    label: 'newfile',
    detail: 'New Spectra file with module and main',
    insertText: ['module ${1:name};', '', 'pub fn main() {', '    ${0}', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'main',
    detail: 'Create the public main function',
    insertText: ['pub fn main() {', '    ${0}', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'fn',
    detail: 'Create a function with parameters and a return type',
    insertText: [
      'fn ${1:name}(${2:param}: ${3:int}) -> ${4:int} {',
      '    ${0}',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'pubfn',
    detail: 'Create a public function',
    insertText: [
      'pub fn ${1:name}(${2:param}: ${3:int}) -> ${4:int} {',
      '    ${0}',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'struct',
    detail: 'Declare a struct',
    insertText: ['struct ${1:Name} {', '    ${2:field}: ${3:int},', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'structimpl',
    detail: 'Declare a struct with an impl block',
    insertText: [
      'struct ${1:Name} {',
      '    ${2:field}: ${3:int},',
      '}',
      '',
      'impl ${1:Name} {',
      '    fn new(${2:field}: ${3:int}) -> ${1:Name} {',
      '        return ${1:Name} { ${2:field}: ${2:field} };',
      '    }',
      '',
      '    fn ${4:method}(self) -> ${5:int} {',
      '        ${0}',
      '    }',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'enum',
    detail: 'Declare an enum',
    insertText: ['enum ${1:Name} {', '    ${2:Variant},', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'enumdata',
    detail: 'Declare an enum with a data variant',
    insertText: [
      'enum ${1:Name} {',
      '    ${2:Some}(${3:int}),',
      '    ${4:None},',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'impl',
    detail: 'Create an impl block with a method',
    insertText: [
      'impl ${1:Type} {',
      '    fn ${2:method}(self) -> ${3:int} {',
      '        ${0}',
      '    }',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'iflet',
    detail: 'Create an if let block to unpack an enum',
    insertText: ['if let ${1:Variant}(${2:value}) = ${3:expr} {', '    ${0}', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'ifletelse',
    detail: 'Create an if let block with else',
    insertText: [
      'if let ${1:Variant}(${2:value}) = ${3:expr} {',
      '    ${4}',
      '} else {',
      '    ${0}',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'whilelet',
    detail: 'Create a while let loop',
    insertText: ['while let ${1:Variant}(${2:value}) = ${3:expr} {', '    ${0}', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'while',
    detail: 'Create a while loop',
    insertText: ['while ${1:condition} {', '    ${0}', '}'].join('\n'),
    kind: 15,
  },
  {
    label: 'for',
    detail: 'Counter loop with while (classic for equivalent)',
    insertText: [
      'let ${1:i} = 0;',
      'while ${1:i} < ${2:10} {',
      '    ${0}',
      '    ${1:i} = ${1:i} + 1;',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'dowhile',
    detail: 'Create a do-while loop',
    insertText: ['do {', '    ${0}', '} while ${1:condition};'].join('\n'),
    kind: 15,
  },
  {
    label: 'loop',
    detail: 'Create an infinite loop with break',
    insertText: [
      'loop {',
      '    ${0}',
      '    if ${1:condition} {',
      '        break;',
      '    }',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'match',
    detail: 'Create a match expression with wildcard',
    insertText: [
      'match ${1:value} {',
      '    ${2:Pattern}(${3:v}) => ${4:v},',
      '    _ => ${0},',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'matchenum',
    detail: 'Create an exhaustive match over an enum',
    insertText: [
      'match ${1:value} {',
      '    ${2:Enum}::${3:VariantA} => ${4},',
      '    ${2:Enum}::${5:VariantB} => ${0},',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'let',
    detail: 'Declare a variable',
    insertText: 'let ${1:name} = ${0};',
    kind: 15,
  },
  {
    label: 'import',
    detail: 'Import specific functions from a module',
    insertText: 'import { ${1:fn_name} } from ${2:std.io};',
    kind: 15,
  },
  {
    label: 'importas',
    detail: 'Import a module with an alias',
    insertText: 'import ${1:std.math} as ${2:math};',
    kind: 15,
  },
  {
    label: 'return',
    detail: 'Return a value',
    insertText: 'return ${0};',
    kind: 15,
  },
  {
    label: 'println',
    detail: 'Print a line (requires import std.io)',
    insertText: 'println(${0});',
    kind: 15,
  },
  {
    label: 'asyncfn',
    detail: 'Create an async function',
    insertText: [
      'pub async fn ${1:name}(${2:param}: ${3:int}) -> ${4:int} {',
      '    ${0}',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'asyncblock',
    detail: 'Create an async block',
    insertText: ['let ${1:task} = async {', '    ${0}', '};'].join('\n'),
    kind: 15,
  },
  {
    label: 'await',
    detail: 'Await a Task<T> inside an async context',
    insertText: 'let ${1:value} = await ${2:task};',
    kind: 15,
  },
  {
    label: 'apihandler',
    detail: 'Create a synchronous spectra.api handler',
    insertText: [
      'pub fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
      '    return std.api.handler.json("${2:{}}");',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'apiasynchandler',
    detail: 'Create an async spectra.api handler',
    insertText: [
      'pub async fn ${1:handle}(request: std.api.http.Request) -> std.api.http.Response {',
      '    return std.api.handler.json("${2:{}}");',
      '}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'apiroute',
    detail: 'Create a spectra.api router with a GET route',
    insertText: [
      'let ${1:router} = std.api.routing.router();',
      'let ${2:route} = std.api.routing.get(${1:router}, "${3:/health}");',
      '${0}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'apicors',
    detail: 'Create a CORS policy and spectra.api middleware',
    insertText: [
      'let ${1:policy} = std.api.cors.permissive();',
      'let ${2:cors} = std.api.cors.middleware(${1:policy});',
      '${0}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'apimiddleware',
    detail: 'Create a spectra.api middleware chain',
    insertText: [
      'let ${1:chain} = std.api.middleware.chain();',
      'let ${2:next} = std.api.middleware.use_sync(${1:chain}, ${3:middleware});',
      'let ${4:response} = std.api.middleware.execute_sync(${2:next}, ${5:request}, ${6:response});',
      '${0}',
    ].join('\n'),
    kind: 15,
  },
  {
    label: 'apijson',
    detail: 'Return a JSON Response through spectra.api',
    insertText: 'return std.api.handler.json("${1:{}}");',
    kind: 15,
  },
  {
    label: 'fstr',
    detail: 'Create an f-string with interpolation',
    insertText: 'f"${0}"',
    kind: 15,
  },
];
