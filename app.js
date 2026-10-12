const $ = (seletor) => document.querySelector(seletor);
const REAL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const gerarId = () => Math.random().toString(36).slice(2, 10);

function escapar(texto) {
  const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(texto).replace(/[&<>"']/g, (c) => mapa[c]);
}

const montarData = (ano, mes, dia) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

const agora = new Date();
const HOJE = montarData(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());

function somarMeses(data, qtd) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const base = new Date(ano, mes - 1 + qtd, 1);
  const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return montarData(base.getFullYear(), base.getMonth() + 1, Math.min(dia, ultimoDia));
}
const somarMesesAnoMes = (anoMes, qtd) => somarMeses(anoMes + '-01', qtd).slice(0, 7);

async function gerarHash(texto) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const memoria = {};

const Armazenamento = {
  ler(chave) {
    try {
      const valor = localStorage.getItem(chave);
      return valor ? JSON.parse(valor) : null;
    } catch (e) {
      return memoria[chave] ?? null;
    }
  },
  salvar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); }
    catch (e) { memoria[chave] = valor; }
  },
};

const Sessao = {
  ler() {
    try { return sessionStorage.getItem('fin:s'); }
    catch (e) { return memoria.sessao || null; }
  },
  gravar(email) {
    try { email ? sessionStorage.setItem('fin:s', email) : sessionStorage.removeItem('fin:s'); }
    catch (e) { memoria.sessao = email; }
  },
};

const estado = {
  modoAuth: 'entrar', 
  usuario: null,
  dados: null, 
  graficos: {},
};
const salvarDados = () => Armazenamento.salvar('fin:data:' + estado.usuario, estado.dados);

const Auth = {
  usuarios: () => Armazenamento.ler('fin:users') || {},

  async cadastrar(nome, email, senha) {
    const usuarios = Auth.usuarios();
    if (usuarios[email]) return 'Este e-mail já tem cadastro. Use a aba Entrar.';
    const sal = gerarId();
    usuarios[email] = { name: nome, salt: sal, hash: await gerarHash(sal + senha) };
    Armazenamento.salvar('fin:users', usuarios);
    Armazenamento.salvar('fin:data:' + email, { tx: [], budgets: {}, goals: [] });
    return null;
  },

  async entrar(email, senha) {
    const conta = Auth.usuarios()[email];
    if (!conta || conta.hash !== (await gerarHash(conta.salt + senha))) return 'E-mail ou senha incorretos.';
    abrirApp(email);
    return null;
  },

  async entrarDemo() {
    const email = 'demo@exemplo.com';
    if (!Auth.usuarios()[email]) {
      await Auth.cadastrar('Conta de demonstração', email, 'demo1234');
      Armazenamento.salvar('fin:data:' + email, dadosDemo());
    }
    return Auth.entrar(email, 'demo1234');
  },
};

function dadosDemo() {
  const mesAtual = HOJE.slice(0, 7);
  const dia5 = (n) => somarMesesAnoMes(mesAtual, n) + '-05';
  let seq = 0;
  const tx = (desc, amount, type, cat, date, rec) => ({ id: 'd' + seq++, desc, amount, type, cat, date, rec: !!rec });
  return {
    tx: [
      tx('Salário', 3500, 'income', 'Salário', dia5(-3), true),
      tx('Aluguel', 1000, 'expense', 'Moradia', dia5(-3), true),
      tx('Mercado', 420, 'expense', 'Alimentação', dia5(-2)),
      tx('Mercado', 380, 'expense', 'Alimentação', dia5(-1)),
      tx('Mercado', 310, 'expense', 'Alimentação', dia5(0)),
      tx('Combustível', 250, 'expense', 'Transporte', dia5(-1)),
      tx('Cinema', 60, 'expense', 'Lazer', dia5(0)),
      tx('Freela de TI', 600, 'income', 'Outros', dia5(-1)),
      tx('Curso online', 300, 'expense', 'Educação', dia5(0)),
    ],
    budgets: { 'Alimentação': 800, 'Lazer': 200, 'Transporte': 300 },
    goals: [{ id: 'g1', name: 'Reserva de emergência', target: 5000, saved: 1200 }],
  };
}

function abrirApp(email) {
  estado.usuario = email;
  Sessao.gravar(email);
  estado.dados = Armazenamento.ler('fin:data:' + email) || { tx: [], budgets: {}, goals: [] };
  estado.dados.budgets = estado.dados.budgets || {};
  estado.dados.goals = estado.dados.goals || [];

  const conta = Auth.usuarios()[email];
  $('#saudacao').textContent = 'Olá, ' + (conta ? conta.name : email);
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#mes').value = HOJE.slice(0, 7);
  $('#trData').value = HOJE;
  renderizar();
}

function sair() {
  Sessao.gravar(null);
  estado.usuario = null;
  estado.dados = null;
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#authSenha').value = '';
}

const Calculos = {
  doMes(anoMes) {
    return estado.dados.tx.filter((t) => (t.rec ? t.date.slice(0, 7) <= anoMes : t.date.slice(0, 7) === anoMes));
  },
  total: (lista, tipo) => lista.filter((t) => t.type === tipo).reduce((soma, t) => soma + t.amount, 0),

  saldoAcumulado(anoMes) {
    if (!estado.dados.tx.length) return 0;
    let mes = estado.dados.tx.map((t) => t.date.slice(0, 7)).sort()[0];
    let saldo = 0;
    for (let i = 0; mes <= anoMes && i < 600; i++, mes = somarMesesAnoMes(mes, 1)) {
      const lista = Calculos.doMes(mes);
      saldo += Calculos.total(lista, 'income') - Calculos.total(lista, 'expense');
    }
    return saldo;
  },

  despesasPorCategoria(lista) {
    const soma = {};
    lista.filter((t) => t.type === 'expense').forEach((t) => { soma[t.cat] = (soma[t.cat] || 0) + t.amount; });
    return soma;
  },
};

function enviarAuth() {
  const email = $('#authEmail').value.trim().toLowerCase();
  const senha = $('#authSenha').value;
  const nome = $('#authNome').value.trim();
  const msg = $('#authMsg');

  if (!/^\S+@\S+\.\S+$/.test(email)) return (msg.textContent = 'Digite um e-mail válido.');
  if (senha.length < 6) return (msg.textContent = 'A senha precisa ter ao menos 6 caracteres.');

  const executar = async () => {
    if (estado.modoAuth === 'criar') {
      if (!nome) return 'Informe seu nome ou empresa.';
      const erro = await Auth.cadastrar(nome, email, senha);
      if (erro) return erro;
    }
    return Auth.entrar(email, senha);
  };
  executar().then((erro) => { msg.textContent = erro || ''; });
}

function trocarModoAuth(modo) {
  estado.modoAuth = modo;
  $('#tabEntrar').classList.toggle('on', modo === 'entrar');
  $('#tabCriar').classList.toggle('on', modo === 'criar');
  $('#campoNome').hidden = modo === 'entrar';
  $('#authEnviar').textContent = modo === 'entrar' ? 'Entrar' : 'Criar conta';
  $('#authSenha').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
  $('#authMsg').textContent = '';
}

function adicionarTransacao() {
  const desc = $('#trDescricao').value.trim();
  const amount = parseFloat($('#trValor').value);
  const cat = $('#trCategoria').value.trim();
  const date = $('#trData').value;
  const type = $('#trTipo').value;
  const rec = $('#trRepeticao').value === 'mensal';
  const parcelas = parseInt($('#trParcelas').value) || 1;
  const msg = $('#trMsg');

  if (!desc || !cat || !date || !(amount > 0)) return (msg.textContent = 'Preencha descrição, valor, categoria e data.');
  if (rec && parcelas > 1) return (msg.textContent = 'Escolha entre transação mensal fixa ou parcelada, não as duas.');
  msg.textContent = '';

  if (parcelas > 1) {
    const valorParcela = Math.round((amount / parcelas) * 100) / 100;
    for (let i = 0; i < parcelas; i++) {
      estado.dados.tx.push({ id: gerarId(), desc: `${desc} (${i + 1}/${parcelas})`, amount: valorParcela, type, cat, date: somarMeses(date, i), rec: false });
    }
  } else {
    estado.dados.tx.push({ id: gerarId(), desc, amount, type, cat, date, rec });
  }
  salvarDados();
  ['#trDescricao', '#trValor', '#trCategoria', '#trParcelas'].forEach((s) => { $(s).value = ''; });
  renderizar();
}

function definirOrcamento() {
  const categoria = $('#orcCategoria').value.trim();
  const limite = parseFloat($('#orcLimite').value);
  if (!categoria || !(limite > 0)) return;
  estado.dados.budgets[categoria] = limite;
  salvarDados();
  $('#orcCategoria').value = $('#orcLimite').value = '';
  renderizar();
}

function criarMeta() {
  const name = $('#metaNome').value.trim();
  const target = parseFloat($('#metaAlvo').value);
  if (!name || !(target > 0)) return;
  estado.dados.goals.push({ id: gerarId(), name, target, saved: 0 });
  salvarDados();
  $('#metaNome').value = $('#metaAlvo').value = '';
  renderizar();
}

function tratarCliqueAcao(evento) {
  const botao = evento.target.closest('[data-acao]');
  if (!botao) return;
  const { acao, id } = botao.dataset;
  const d = estado.dados;

  if (acao === 'excluir-tx') d.tx = d.tx.filter((t) => t.id !== id);
  else if (acao === 'excluir-orc') delete d.budgets[id];
  else if (acao === 'excluir-meta') d.goals = d.goals.filter((g) => g.id !== id);
  else if (acao === 'guardar') {
    const valor = parseFloat(document.getElementById('guardar-' + id).value);
    if (!(valor > 0)) return;
    d.goals.find((g) => g.id === id).saved += valor;
  }
  salvarDados();
  renderizar();
}

function renderizar() {
  const anoMes = $('#mes').value || HOJE.slice(0, 7);
  const lista = Calculos.doMes(anoMes);
  renderizarResumo(anoMes, lista);
  renderizarTabela(lista);
  renderizarOrcamentos(lista);
  renderizarMetas();
  Graficos.desenhar(anoMes, lista);
}

function renderizarResumo(anoMes, lista) {
  const receitas = Calculos.total(lista, 'income');
  const despesas = Calculos.total(lista, 'expense');
  $('#resAcumulado').textContent = REAL.format(Calculos.saldoAcumulado(anoMes));
  $('#resReceitas').textContent = REAL.format(receitas);
  $('#resDespesas').textContent = REAL.format(despesas);
  const resultado = $('#resResultado');
  resultado.textContent = REAL.format(receitas - despesas);
  resultado.className = receitas - despesas < 0 ? 'exp' : 'inc';
}

function renderizarTabela(lista) {
  const busca = $('#filtroBusca').value.toLowerCase();
  const tipo = $('#filtroTipo').value;
  const linhas = lista
    .filter((t) => (!tipo || t.type === tipo) && (!busca || (t.desc + ' ' + t.cat).toLowerCase().includes(busca)))
    .sort((a, b) => b.date.localeCompare(a.date));

  $('#corpoTabela').innerHTML = linhas.map((t) => {
    const data = t.rec ? 'Mensal' : t.date.split('-').reverse().join('/');
    const classe = t.type === 'income' ? 'inc' : 'exp';
    const sinal = t.type === 'income' ? '+' : '−';
    return `<tr>
      <td>${data}</td><td>${escapar(t.desc)}</td><td>${escapar(t.cat)}</td>
      <td class="n ${classe}">${sinal} ${REAL.format(t.amount)}</td>
      <td><button class="x" data-acao="excluir-tx" data-id="${t.id}" aria-label="Excluir ${escapar(t.desc)}">✕</button></td>
    </tr>`;
  }).join('');
  $('#semTransacoes').hidden = linhas.length > 0;
}

function renderizarOrcamentos(lista) {
  const gasto = {};
  lista.filter((t) => t.type === 'expense').forEach((t) => {
    const chave = t.cat.toLowerCase();
    gasto[chave] = (gasto[chave] || 0) + t.amount;
  });
  const orcamentos = Object.entries(estado.dados.budgets);

  $('#listaOrcamentos').innerHTML = orcamentos.length ? orcamentos.map(([categoria, limite]) => {
    const usado = gasto[categoria.toLowerCase()] || 0;
    const pct = (usado / limite) * 100;
    const estourou = pct > 100;
    return `<div class="item">
      <div class="h"><span>${escapar(categoria)}</span>
        <span><span class="${estourou ? 'exp' : ''}">${REAL.format(usado)}</span> de ${REAL.format(limite)}
          <button class="x" data-acao="excluir-orc" data-id="${escapar(categoria)}" aria-label="Remover orçamento ${escapar(categoria)}">✕</button></span></div>
      <div class="bar"><i class="${estourou ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></i></div>
      ${estourou ? `<small class="exp">Limite excedido em ${REAL.format(usado - limite)}</small>` : ''}
    </div>`;
  }).join('') : '<p class="empty">Defina um limite mensal para uma categoria e acompanhe o gasto.</p>';
}

function renderizarMetas() {
  const metas = estado.dados.goals;
  $('#listaMetas').innerHTML = metas.length ? metas.map((g) => {
    const pct = Math.min((g.saved / g.target) * 100, 100);
    return `<div class="item">
      <div class="h"><b>${escapar(g.name)}</b>
        <span>${REAL.format(g.saved)} de ${REAL.format(g.target)} (${pct.toFixed(0)}%)
          <button class="x" data-acao="excluir-meta" data-id="${g.id}" aria-label="Excluir meta ${escapar(g.name)}">✕</button></span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="inline">
        <input id="guardar-${g.id}" type="number" min="0.01" step="0.01" placeholder="Guardar R$" aria-label="Valor a guardar">
        <button type="button" class="ghost" data-acao="guardar" data-id="${g.id}">Guardar</button>
      </div>
    </div>`;
  }).join('') : '<p class="empty">Crie uma meta, como uma viagem ou uma reserva de emergência.</p>';
}

const Graficos = {
  desenhar(anoMes, lista) {
    if (!window.Chart) return;
    const css = getComputedStyle(document.documentElement);
    const cor = (variavel) => css.getPropertyValue(variavel).trim();
    const eixo = { ticks: { color: cor('--mu') }, grid: { color: cor('--ln') } };
    Object.values(estado.graficos).forEach((g) => g.destroy());
    estado.graficos = {};

    const meses = [-5, -4, -3, -2, -1, 0].map((n) => somarMesesAnoMes(anoMes, n));
    const rotulos = meses.map((m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    estado.graficos.barras = new Chart($('#grafBarras'), {
      type: 'bar',
      data: {
        labels: rotulos,
        datasets: [
          { label: 'Receitas', data: meses.map((m) => Calculos.total(Calculos.doMes(m), 'income')), backgroundColor: cor('--inc') },
          { label: 'Despesas', data: meses.map((m) => Calculos.total(Calculos.doMes(m), 'expense')), backgroundColor: cor('--exp') },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: cor('--ink') } } },
        scales: { x: eixo, y: { ...eixo, beginAtZero: true } },
      },
    });

    const porCategoria = Calculos.despesasPorCategoria(lista);
    const nomes = Object.keys(porCategoria);
    $('#semCategorias').hidden = nomes.length > 0;
    $('#boxCategorias').hidden = nomes.length === 0;
    if (!nomes.length) return;
    estado.graficos.rosca = new Chart($('#grafCategorias'), {
      type: 'doughnut',
      data: {
        labels: nomes,
        datasets: [{
          data: nomes.map((n) => porCategoria[n]),
          backgroundColor: ['#0b6e63', '#e0a030', '#c4452d', '#3b7dd8', '#8e5bb5', '#5fa85f', '#d97f9b', '#7a8a93'],
          borderColor: cor('--sf'),
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: cor('--ink') } } } },
    });
  },
};

function iniciarEventos() {
  $('#tabEntrar').onclick = () => trocarModoAuth('entrar');
  $('#tabCriar').onclick = () => trocarModoAuth('criar');
  $('#authEnviar').onclick = enviarAuth;
  $('#authDemo').onclick = () => Auth.entrarDemo().then((erro) => { $('#authMsg').textContent = erro || ''; });
  ['#authEmail', '#authSenha', '#authNome'].forEach((s) =>
    $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarAuth(); }));

  $('#sair').onclick = sair;
  $('#trAdicionar').onclick = adicionarTransacao;
  $('#orcDefinir').onclick = definirOrcamento;
  $('#metaCriar').onclick = criarMeta;
  document.addEventListener('click', tratarCliqueAcao);
  ['#mes', '#filtroBusca', '#filtroTipo'].forEach((s) =>
    $(s).addEventListener('input', () => { if (estado.dados) renderizar(); }));
}

iniciarEventos();
const sessaoSalva = Sessao.ler();
if (sessaoSalva && Auth.usuarios()[sessaoSalva]) abrirApp(sessaoSalva);
