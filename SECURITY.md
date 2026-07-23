# Política de Segurança

## Reportando uma Vulnerabilidade

**NÃO abra issues públicas para vulnerabilidades de segurança.** Em vez disso, reporte responsavelmente para security@hyscode.dev.

### Diretrizes de Relato

Para relatar uma vulnerabilidade de segurança, inclua:

1. **Descrição**: Explique a vulnerabilidade com clareza e detalhes
2. **Reprodução**: Passos para reproduzir a vulnerabilidade (se possível)
3. **Impacto**: Qual é o impacto potencial?
4. **Versão**: Versão(ões) do HysCode afetadas
5. **Informações do Ambiente**: OS, versão do Node.js, etc.

### Tempo de Resposta

- **Confirmação inicial**: Dentro de 48 horas
- **Primeira análise**: Dentro de 7 dias
- **Patch/divulgação**: Conforme a severidade

### Divulgação Coordenada

Seguimos a prática de divulgação coordenada:

1. Você relata a vulnerabilidade de forma privada
2. Confirmamos e desenvolvemos um patch
3. Lançamos uma versão corrigida
4. Publicamos um aviso de segurança
5. Você recebe crédito (se desejado)

## Versões Suportadas

| Versão | Suportada          |
| ------ | ------------------ |
| 0.1.x  | ✅ Ativo          |
| < 0.1  | ❌ Não suportado  |

## Considerações de Segurança

### Dependências

O HysCode utiliza várias dependências de terceiros. Mantemos essas dependências atualizadas e monitoramos por vulnerabilidades conhecidas usando ferramentas como Dependabot.

### Comunicação com Serviços Externos

- **Claude API**: Comunicação criptografada via HTTPS
- **GitHub**: Integração autenticada com tokens
- **Docker**: Comunicação local (socket)

## Contato de Segurança

- **Email**: security@hyscode.dev
- **GPG Key**: Disponível em request

---

Agradecemos sua ajuda em manter o HysCode seguro!
