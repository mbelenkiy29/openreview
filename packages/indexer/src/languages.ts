// Tree-sitter queries per language. Captures: `@name` inside `@def.<kind>` for definitions,
// `@ref` for call/type references and `@source` for import specifiers.
export type LanguageId='typescript'|'tsx'|'javascript'|'python'|'go'|'java'|'rust'|'ruby'|'csharp'|'php'|'cpp';
export type LanguageSpec={id:LanguageId;wasm:string;extensions:string[];defs:string;refs:string;imports:string};

const jsRefs=`
(call_expression function: [(identifier) @ref (member_expression property: (property_identifier) @ref.member)])
(new_expression constructor: [(identifier) @ref (member_expression property: (property_identifier) @ref.member)])`;
const jsImports=`
(import_statement source: (string (string_fragment) @source))
(export_statement source: (string (string_fragment) @source))
(call_expression function: (identifier) @_f arguments: (arguments . (string (string_fragment) @source)) (#eq? @_f "require"))
(call_expression function: (import) arguments: (arguments . (string (string_fragment) @source)))`;
const jsDefs=(className:string)=>`
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (${className}) @name) @def.class
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @def.method
(variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)]) @def.function
(program (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @name) @def.variable)))`;
const tsDefs=`${jsDefs('type_identifier')}
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(abstract_method_signature name: (property_identifier) @name) @def.method`;
const jsx=`
(jsx_opening_element name: (identifier) @ref)
(jsx_self_closing_element name: (identifier) @ref)`;

export const LANGUAGES:LanguageSpec[]=[
  {id:'typescript',wasm:'tree-sitter-typescript.wasm',extensions:['.ts','.mts','.cts'],defs:tsDefs,refs:`${jsRefs}\n(type_identifier) @ref`,imports:jsImports},
  {id:'tsx',wasm:'tree-sitter-tsx.wasm',extensions:['.tsx'],defs:tsDefs,refs:`${jsRefs}\n(type_identifier) @ref${jsx}`,imports:jsImports},
  {id:'javascript',wasm:'tree-sitter-javascript.wasm',extensions:['.js','.jsx','.mjs','.cjs'],defs:jsDefs('identifier'),refs:`${jsRefs}${jsx}`,imports:jsImports},
  {id:'python',wasm:'tree-sitter-python.wasm',extensions:['.py'],
    defs:`
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
(module (expression_statement (assignment left: (identifier) @name)) @def.variable)`,
    refs:`(call function: [(identifier) @ref (attribute attribute: (identifier) @ref.member)])
(class_definition superclasses: (argument_list (identifier) @ref))
(type (identifier) @ref)`,
    imports:`
(import_statement name: (dotted_name) @source)
(import_statement name: (aliased_import name: (dotted_name) @source))
(import_from_statement module_name: [(dotted_name) (relative_import)] @source)`},
  {id:'go',wasm:'tree-sitter-go.wasm',extensions:['.go'],
    defs:`
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.method
(type_spec name: (type_identifier) @name) @def.type`,
    refs:`(call_expression function: [(identifier) @ref (selector_expression field: (field_identifier) @ref.member)])
(type_identifier) @ref`,
    imports:`(import_spec path: (interpreted_string_literal) @source)`},
  {id:'java',wasm:'tree-sitter-java.wasm',extensions:['.java'],
    defs:`
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(enum_declaration name: (identifier) @name) @def.enum
(record_declaration name: (identifier) @name) @def.class
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.method`,
    refs:`(method_invocation name: (identifier) @ref)
(object_creation_expression type: (type_identifier) @ref)
(type_identifier) @ref`,
    imports:`(import_declaration (scoped_identifier) @source)`},
  {id:'rust',wasm:'tree-sitter-rust.wasm',extensions:['.rs'],
    defs:`
(function_item name: (identifier) @name) @def.function
(function_signature_item name: (identifier) @name) @def.method
(struct_item name: (type_identifier) @name) @def.class
(enum_item name: (type_identifier) @name) @def.enum
(trait_item name: (type_identifier) @name) @def.interface
(type_item name: (type_identifier) @name) @def.type`,
    refs:`(call_expression function: [(identifier) @ref (field_expression field: (field_identifier) @ref.member) (scoped_identifier name: (identifier) @ref.qualified)])
(macro_invocation macro: (identifier) @ref)
(type_identifier) @ref`,
    imports:`(use_declaration argument: (_) @source)
(mod_item name: (identifier) @source)`},
  {id:'ruby',wasm:'tree-sitter-ruby.wasm',extensions:['.rb'],
    defs:`
(method name: (_) @name) @def.method
(singleton_method name: (_) @name) @def.method
(class name: [(constant) (scope_resolution)] @name) @def.class
(module name: [(constant) (scope_resolution)] @name) @def.class`,
    refs:`(call method: (identifier) @ref)
(constant) @ref`,
    imports:`(call method: (identifier) @_m arguments: (argument_list . (string (string_content) @source)) (#match? @_m "^require"))`},
  {id:'csharp',wasm:'tree-sitter-c-sharp.wasm',extensions:['.cs'],
    defs:`
(class_declaration name: (identifier) @name) @def.class
(interface_declaration name: (identifier) @name) @def.interface
(struct_declaration name: (identifier) @name) @def.class
(record_declaration name: (identifier) @name) @def.class
(enum_declaration name: (identifier) @name) @def.enum
(method_declaration name: (identifier) @name) @def.method
(constructor_declaration name: (identifier) @name) @def.method`,
    refs:`(invocation_expression function: [(identifier) @ref (member_access_expression name: (identifier) @ref.member)])
(object_creation_expression type: (identifier) @ref)
(base_list (identifier) @ref)`,
    imports:`(using_directive [(qualified_name) (identifier)] @source)`},
  {id:'php',wasm:'tree-sitter-php.wasm',extensions:['.php'],
    defs:`
(function_definition name: (name) @name) @def.function
(method_declaration name: (name) @name) @def.method
(class_declaration name: (name) @name) @def.class
(interface_declaration name: (name) @name) @def.interface`,
    refs:`(function_call_expression function: (name) @ref)
(member_call_expression name: (name) @ref.member)
(scoped_call_expression name: (name) @ref.qualified)
(object_creation_expression (name) @ref)`,
    imports:`(namespace_use_clause (qualified_name) @source)`},
  {id:'cpp',wasm:'tree-sitter-cpp.wasm',extensions:['.c','.h','.cc','.cpp','.cxx','.hpp','.hh'],
    defs:`
(function_definition declarator: (function_declarator declarator: [(identifier) (field_identifier)] @name)) @def.function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @def.method
(class_specifier name: (type_identifier) @name body: (_)) @def.class
(struct_specifier name: (type_identifier) @name body: (_)) @def.class`,
    refs:`(call_expression function: [(identifier) @ref (field_expression field: (field_identifier) @ref.member) (qualified_identifier name: (identifier) @ref.qualified)])
(type_identifier) @ref`,
    imports:`(preproc_include path: [(string_literal) (system_lib_string)] @source)`},
];

const byExtension=new Map(LANGUAGES.flatMap(l=>l.extensions.map(e=>[e,l] as const)));
export function languageFor(path:string):LanguageSpec|undefined{const dot=path.lastIndexOf('.');return dot<0?undefined:byExtension.get(path.slice(dot).toLowerCase())}
// Text formats worth reviewing even though they carry no code graph.
const TEXT=/(\.(json|ya?ml|toml|sql|sh|bash|tf|hcl|gradle|kts|xml|proto|graphql|gql|css|scss|vue|svelte|swift|kt|scala|ex|exs|erl|lua|dart|r|pl|ini|conf|env\.example)$|(^|\/)(Dockerfile|Makefile|Gemfile|Rakefile)$)/i;
export function isReviewable(path:string){return !!languageFor(path)||TEXT.test(path)}
