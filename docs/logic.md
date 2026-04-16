# Logic

Este documento organiza a lógica do serviço Ehecoatl em linguagem humana.

Ele não tenta listar tudo.

Ele tenta explicar:

- decisões lógicas
- motivações
- modo de implementação
- pontos em que uma leitura crítica pode encontrar incoerências

Ele deve ser lido como um mapa do comportamento do serviço.

Ele parte do runtime atual como fonte principal.

Outras páginas da documentação podem divergir em alguns pontos.

## 1. Contratos

### Decisão

O serviço usa contratos como fonte declarativa do runtime.

### Motivo

O objetivo é separar intenção estrutural de implementação operacional.

A ideia é que setup, CLI, runtime, bootstrap e documentação partam da mesma topologia lógica.

### Implementação

Os contratos declaram dados como:

- layers
- setup identities
- processos
- paths
- CLI specs
- snapshots
- derivers

O contrato raiz organiza o serviço em uma cadeia lógica de isolamento:

- `appScope`
- `tenantScope`
- `supervisionScope`
- `internalScope`

Cada layer descreve:

- propósito
- paths e defaults
- atores de shell
- atores de processo
- identidade
- fronteiras de acesso

## 2. Layers de Escopo

### Decisão

O ambiente lógico é subdividido em scopes.

### Motivo

O serviço precisa separar:

- arquivos internos de instalação
- superfícies de supervisão
- superfícies compartilhadas do tenant
- superfícies locais do app

Essa divisão reduz mistura entre runtime, operação e customização.

### Implementação

`internal-scope` é a camada escondida do serviço.

Ela guarda:

- instalação empacotada
- registry interno
- runtime lib
- estado protegido do serviço

`supervision-scope` é a camada de supervisão do serviço.

Ela expõe apenas superfícies de nível de serviço.

Exemplos:

- config do serviço
- extensões de nível core
- operação do lifecycle

`tenant-scope` é a camada compartilhada do tenant.

Ela centraliza override e recursos comuns aos apps do tenant.

`app-scope` é a camada local do app.

Ela isola o que pertence só àquele app.

## 3. Usuários, Owners e Processos

### Decisão

Ownership, login e execução são conceitos separados.

### Motivo

Um mesmo usuário não deve concentrar:

- posse de arquivos internos
- acesso humano
- execução de processos

Separar esses papéis melhora isolamento e torna incoerências mais visíveis.

### Implementação

`ehecoatl:ehecoatl` é a identidade interna do serviço.

Ela continua sendo a base da instalação protegida.

Ela não é a superfície humana principal.

Os deploys criam usuários de escopo:

- `u_supervisor_{install_id}`
- `u_tenant_{tenant_id}`
- `u_app_{tenant_id}_{app_id}`

Esses usuários existem para representar scopes e owners.

O setup cria o necessário para a instalação.

Os deploys criam o necessário para tenants e apps.

No runtime atual, o isolamento de processo caminha para usuários dedicados:

- `e_transport_{tenant_id}` usa `u_tenant_{tenant_id}`
- `e_app_{tenant_id}_{app_id}` usa `u_app_{tenant_id}_{app_id}`

Isso separa melhor o processo do serviço interno e abre caminho para controle por owner no firewall.

## 4. Grupos e Isolamento

### Decisão

Grupos representam níveis de acesso à topologia.

### Motivo

O grupo é o mecanismo lógico que traduz o escopo.

Ele expressa pertencimento sem precisar transformar toda regra em ACL.

### Implementação

Os grupos mais relevantes são:

- `ehecoatl`
- `g_superScope`
- `g_director`
- `g_tenantScope_{tenant_id}`
- `g_appScope_{tenant_id}_{app_id}`

O grupo principal de filesystem do tenant é o grupo do tenant.

O grupo principal do app também pode ser o grupo do tenant para permitir cooperação controlada.

Isso faz o owner + group virar o eixo principal do acesso.

O grupo do app continua existindo como identidade de escopo.

Mas ele não precisa ser sempre o grupo primário da árvore do app.

## 5. Owner + Group como Regra Principal

### Decisão

Tenant e app devem funcionar por owner + Unix group.

### Motivo

A meta é evitar que o runtime normal dependa de ACL nova para funcionar.

ACL fica como ferramenta de borda.

Não como base do data plane.

### Implementação

A regra pretendida é:

- árvore do tenant owned por `u_tenant_{tenant_id}:g_tenantScope_{tenant_id}`
- árvore do app owned por `u_app_{tenant_id}_{app_id}:g_tenantScope_{tenant_id}`

Isso permite:

- `transport` enxergar a área do tenant
- `transport` enxergar apps do próprio tenant pelo grupo do tenant
- `isolatedRuntime` escrever no próprio app pelo owner
- `isolatedRuntime` ler o contexto compartilhado do tenant pelo grupo

ACL continua podendo existir em pontos operacionais.

Mas ela não deve ser necessária para o acesso normal de `transport` e `isolatedRuntime`.

## 6. Director

### Decisão

O `director` é a fonte operacional de verdade do runtime ativo.

### Motivo

O serviço precisa de um processo dedicado a observar a topologia e reconciliar o que deve estar rodando.

### Implementação

O `director` faz scan periódico da árvore de tenants e apps.

Ele atualiza o registry ativo.

Ele reconcilia:

- `e_transport_{tenant_id}`
- `e_app_{tenant_id}_{app_id}`

Ele detecta:

- surgimento
- remoção
- mudança de rota
- mudança de porta
- drift de processo

Ele também sincroniza dois blocos externos ao request:

- `webserver-service`
- bridge de firewall

Na prática, o `director` não é só um scanner.

Ele é o reconciler do que existe no disco com o que deve existir em execução.

## 7. Firewall e Rede

### Decisão

O serviço tem dois comandos internos de firewall com papéis diferentes.

### Motivo

A rede precisa ser tratada como parte do isolamento de processo.

Filesystem sozinho não resolve exposição indevida de portas.

### Implementação

`newtork_wan_block` existe para cercar WAN TCP por owner de processo.

Ele aplica cadeias de `INPUT` e `OUTPUT`.

Ele bloqueia WAN e preserva o que for explicitamente necessário.

No runtime, esse comportamento também aparece como lifecycle plugin de processo.

`newtork_local_proxy` existe para cercar loopback.

Ele bloqueia `127.0.0.1` por user e libera apenas uma allowlist de portas.

No modelo atual, essa allowlist é aplicada por usuário de `transport`.

O raciocínio é simples:

- só o `transport` deve falar com suas portas locais
- o `app` não deve herdar esse acesso

As portas internas por tenant ficam na faixa `14xxx`.

O registry reconciliado publica:

- `internalProxy.httpPort`
- `internalProxy.wsPort`

O bridge de bootstrap mantém um mapa do que está liberado por user de `transport`.

No shutdown, esse estado é limpo.

## 8. Webserver e Proxy Local

### Decisão

O acesso WAN entra por webserver e é encaminhado para proxy local por tenant.

### Motivo

Isso separa exposição pública de execução do runtime.

Também permite que o tenant customize a projeção Nginx sem editar o core do serviço.

### Implementação

`webserver-service` projeta o estado do registry para a camada WAN.

No runtime atual, o alvo principal é Nginx.

Cada tenant recebe configuração renderizada com:

- domínio principal
- wildcard do domínio principal
- aliases
- wildcards dos aliases
- upstream HTTP local
- upstream WS local

O template de Nginx não vem de um template global rígido.

Ele vem do próprio tenant:

- `{tenantRoot}/.ehecoatl/lib/nginx.e.conf`

O tenant kit padrão já carrega esse arquivo.

Se ele não existir em um tenant antigo, o serviço pode materializar uma cópia inicial.

Depois disso, a cópia local do tenant vira a fonte da renderização.

## 9. Ingress e Lifecycle de Request

### Decisão

Cada tenant tem um `transport` próprio para HTTP e WS.

### Motivo

Isso concentra o lifecycle de entrada por tenant e reduz mistura entre roteamento, middleware e execução de app.

### Implementação

O `transport` recebe:

- `tenantId`
- `tenantDomain`
- `tenantRoot`
- `httpPort`
- `wsPort`

Essas portas vêm do registry reconciliado.

O `transport` sobe o ingress runtime.

Ele aceita HTTP e WS.

Ele cria `ExecutionContext`.

Ele resolve rota antes do stack.

Ele pergunta ao `director` o que precisa saber sobre topology ativa.

Quando a rota aponta para app runtime, ele aciona o `e_app_{tenant_id}_{app_id}` correspondente.

O request passa por:

- normalização
- resolução de tenant/app/route
- middleware stack
- execução de action quando necessário
- escrita da resposta

## 10. Middleware Stack

### Decisão

O middleware stack é dividido em dois grupos lógicos.

### Motivo

O runtime precisa separar:

- middlewares internos do core
- middlewares configuráveis por tenant/app

Também precisa esconder parte do contexto interno das extensões.

### Implementação

O primeiro grupo é o core stack.

Ele é carregado do runtime e executado com `ExecutionContext`.

Ele tem acesso ao contexto interno completo do request.

O segundo grupo é o stack de labels de rota.

Ele é resolvido a partir da propriedade `middleware` da rota.

Esses labels são procurados em:

- tenant HTTP middleware registry
- app HTTP middleware registry

O app tem precedência sobre o tenant para o mesmo label.

Nesse segundo grupo, o objeto passado ao middleware é `MiddlewareContext`.

Essa separação existe para esconder acessos internos sensíveis.

O core pode ver mais.

As extensões de tenant/app devem ver menos.

## 11. Tenant como Camada de Override

### Decisão

A pasta `shared/` do tenant é a base de override comum aos apps.

### Motivo

Nem toda customização deve morar dentro de um app específico.

Algumas decisões são do tenant inteiro.

### Implementação

No tenant, `shared/` concentra o que pode ser reutilizado entre apps.

Isso inclui:

- configuração compartilhada
- rotas compartilhadas
- plugins compartilhados
- middlewares por protocolo

Hoje a lógica mais relevante é:

- `shared/app/http/middlewares`
- `shared/app/ws/middlewares`

O tenant funciona como uma camada intermediária.

Ele não é só container de apps.

Ele também é o ponto de override comum antes do app local.

## 12. Como Detectar Incoerências

Use esta lista como leitura crítica.

Se algum item falhar, a lógica do serviço pode estar inconsistente.

- o processo roda com user diferente do que o contract declara
- o owner da árvore não combina com o user que precisa escrever nela
- o group do filesystem não combina com o acesso que o processo precisa ter
- o app depende de ACL nova para algo que deveria funcionar por owner + group
- a documentação diz que todos os processos usam a mesma identidade, mas o runtime usa users dedicados
- o firewall local abre portas para user errado
- o app runtime consegue acessar portas locais que deveriam ser exclusivas do transport
- o webserver renderiza Nginx de um template global quando a regra lógica diz template local do tenant
- o middleware de tenant/app recebe contexto interno demais
- o `director` deixa de ser a fonte do reconcile e vira só um scanner passivo
- o registry deixa de refletir portas, aliases ou identities necessárias para o runtime

## 13. Leitura Final

Em termos lógicos, o Ehecoatl tenta sustentar uma ideia central:

o serviço é um runtime supervisionado, multi-processo, com topologia declarada por contratos, reconciliação feita pelo `director`, exposição WAN por proxy local, e isolamento construído pela combinação de:

- scopes
- identities
- groups
- ownership
- firewall
- middleware boundaries

Quando essas peças concordam entre si, o sistema fica previsível.

Quando uma delas diverge, a incoerência costuma aparecer em três lugares:

- acesso a arquivo
- acesso a porta
- documentação dizendo uma coisa e o runtime fazendo outra
