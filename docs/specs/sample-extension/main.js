// Sample Extension - main.js
// Demonstra: ativação, comandos na paleta, terminal, notificações

async function activate(context) {
  // Sempre use context._api para acessar a API do HysCode
  const api = context._api || globalThis.hyscode;

  console.log(`[${context.extensionName}] Ativado em: ${context.extensionPath}`);

  // Estado persistente
  const count = (context.globalState.get('launchCount') || 0) + 1;
  context.globalState.update('launchCount', count);

  // Registrar comando (ID deve ser idêntico ao extension.json)
  const cmd = api.commands.register('sample.helloWorld', async () => {
    // Coletar input do usuário
    const nome = await api.window.showInputBox({
      title: 'Olá Mundo',
      prompt: 'Digite seu nome',
      placeHolder: 'ex: Maria',
    });

    if (!nome) return; // usuário cancelou com Esc

    // Mostrar notificação
    api.notifications.showInfo(`Olá, ${nome}! (execução nº ${count})`);

    // Enviar comando ao terminal integrado
    await api.terminal.sendToActive(`echo "Olá, ${nome}!"`);
  });

  // Registrar segundo comando que usa process.exec (output capturado)
  const cmd2 = api.commands.register('sample.listarArquivos', async () => {
    try {
      const saida = await api.process.exec('ls', ['-la']);
      api.notifications.showInfo(`Arquivos:\n${saida}`);
    } catch (err) {
      api.notifications.showError(`Erro: ${err}`);
    }
  });

  // Limpar ao desativar
  context.subscriptions.push(cmd, cmd2);
}

function deactivate() {
  console.log('[sample-extension] Desativado.');
}

module.exports = { activate, deactivate };
