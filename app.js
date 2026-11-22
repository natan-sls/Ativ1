/* ==========================================================
   Controle Financeiro — lógica da aplicação (JavaScript)
   Organização:
     1. Utilitários        5. Ações do usuário
     2. Armazenamento      6. Interface (renderização)
     3. Autenticação       7. Gráficos
     4. Cálculos           8. Início

   Cada login pode ter carteiras independentes. O tipo fica no cadastro:
     kind: 'cpf'  pessoa física  — orçamento e metas pessoais
     kind: 'cnpj' pessoa jurídica — caixa, contas, contatos e imposto
   O documento (CPF ou CNPJ) é validado pelos dígitos verificadores.
   Lançamentos de uma carteira nunca entram na outra. Contas antigas são
   migradas para a carteira correspondente no primeiro acesso.

   Dados salvos por e-mail e tipo de carteira:
     { tx: [{id, desc, amount, type, cat, date, rec, contactId, billId, taxMark}],
       budgets: {categoria: limite},
       goals: [{id, name, target, saved}],
       contacts: [{id, name, role, phone}],
       bills: [{id, kind, desc, amount, due, cat, contactId, status, paidAt, txId}],
       tax: { rate, das } }
   ========================================================== */

const $ = (seletor) => document.querySelector(seletor);
const REAL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const gerarId = () => Math.random().toString(36).slice(2, 10);

const CATEGORIAS = {
  cpf: ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Salário', 'Outros'],
  cnpj: ['Vendas', 'Serviços', 'Fornecedores', 'Impostos', 'Pró-labore', 'Aluguel', 'Marketing', 'Estoque', 'Taxas', 'Funcionários', 'Outros'],
};

const REGIMES = {
  mei: 'MEI',
  simples: 'Simples Nacional',
  presumido: 'Lucro Presumido',
};

function escapar(texto) {
  const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(texto).replace(/[&<>"']/g, (c) => mapa[c]);
}

const apenasDigitos = (texto) => String(texto || '').replace(/\D/g, '');

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

function dataPorExtenso(iso) {
  return iso.split('-').reverse().join('/');
}

function mascararDocumento(valor, kind) {
  const digitos = apenasDigitos(valor).slice(0, kind === 'cnpj' ? 14 : 11);
  if (kind === 'cnpj') {
    return digitos
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  }
  return digitos
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function formatarDocumento(doc, kind) {
  return mascararDocumento(doc, kind);
}

function validarCPF(cpf) {
  const d = apenasDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const digito = (tamanho) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

function validarCNPJ(cnpj) {
  const d = apenasDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const digito = (tamanho) => {
    const pesos = tamanho === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((total, peso, i) => total + Number(d[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

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
  tipoCadastro: 'cpf',
  tipoCarteiraAtual: 'cpf',
  tipoCarteiraPendente: null,
  usuario: null,
  dados: null,
  graficos: {},
};

const chaveDados = (email, kind) => `fin:data:${email}:${kind}`;
const salvarDados = () => Armazenamento.salvar(chaveDados(estado.usuario, estado.tipoCarteiraAtual), estado.dados);

function carteirasDaConta(conta) {
  if (!conta.wallets) {
    const kind = conta.kind === 'cnpj' ? 'cnpj' : 'cpf';
    conta.wallets = {
      [kind]: {
        name: conta.name || '',
        document: conta.document || '',
        tradeName: conta.tradeName || '',
        regime: conta.regime || '',
      },
    };
  }
  return conta.wallets;
}

function perfilDaConta(conta, kind) {
  const perfil = carteirasDaConta(conta)[kind] || {};
  return {
    name: perfil.name || '',
    kind,
    document: perfil.document || '',
    tradeName: perfil.tradeName || '',
    regime: kind === 'cnpj' ? (perfil.regime || 'simples') : '',
  };
}

function prepararConta(email) {
  const usuarios = Auth.usuarios();
  const conta = usuarios[email];
  if (!conta) return null;
  const eraLegada = !conta.wallets;
  carteirasDaConta(conta);
  if (eraLegada) {
    const kind = Object.keys(conta.wallets)[0];
    const antiga = Armazenamento.ler('fin:data:' + email);
    if (antiga && !Armazenamento.ler(chaveDados(email, kind))) {
      Armazenamento.salvar(chaveDados(email, kind), antiga);
    }
    Armazenamento.salvar('fin:users', usuarios);
  }
  return conta;
}

function dadosVazios(kind) {
  return {
    tx: [],
    budgets: {},
    goals: [],
    contacts: [],
    bills: [],
    tax: { rate: kind === 'cnpj' ? 6 : 0, das: 0 },
  };
}

function normalizarDados(dados, kind) {
  const base = dados && typeof dados === 'object' ? dados : {};
  base.tx = Array.isArray(base.tx) ? base.tx : [];
  base.budgets = base.budgets && typeof base.budgets === 'object' ? base.budgets : {};
  base.goals = Array.isArray(base.goals) ? base.goals : [];
  base.contacts = Array.isArray(base.contacts) ? base.contacts : [];
  base.bills = Array.isArray(base.bills) ? base.bills : [];
  base.tax = base.tax && typeof base.tax === 'object' ? base.tax : {};
  if (typeof base.tax.rate !== 'number') base.tax.rate = kind === 'cnpj' ? 6 : 0;
  if (typeof base.tax.das !== 'number') base.tax.das = 0;
  return base;
}

const Auth = {
  usuarios: () => Armazenamento.ler('fin:users') || {},

  async cadastrar(perfil, email, senha) {
    const usuarios = Auth.usuarios();
    if (usuarios[email]) return 'Este e-mail já tem cadastro. Use a aba Entrar.';
    const documento = apenasDigitos(perfil.document);
    const duplicado = Object.values(usuarios).some((conta) =>
      Object.values(carteirasDaConta(conta)).some((carteira) => apenasDigitos(carteira.document) === documento));
    if (duplicado) return 'Já existe uma carteira com este CPF ou CNPJ.';

    const sal = gerarId();
    usuarios[email] = {
      wallets: {
        [perfil.kind]: {
          name: perfil.name,
          document: documento,
          tradeName: perfil.tradeName || '',
          regime: perfil.kind === 'cnpj' ? perfil.regime : '',
        },
      },
      walletChoiceAsked: true,
      lastWallet: perfil.kind,
      salt: sal,
      hash: await gerarHash(sal + senha),
    };
    Armazenamento.salvar('fin:users', usuarios);
    Armazenamento.salvar(chaveDados(email, perfil.kind), dadosVazios(perfil.kind));
    return null;
  },

  async entrar(email, senha) {
    const conta = Auth.usuarios()[email];
    if (!conta || conta.hash !== (await gerarHash(conta.salt + senha))) return 'E-mail ou senha incorretos.';
    prepararConta(email);
    const contaAtualizada = Auth.usuarios()[email];
    if (contaAtualizada.walletChoiceAsked) {
      const kind = contaAtualizada.wallets[contaAtualizada.lastWallet]
        ? contaAtualizada.lastWallet
        : Object.keys(contaAtualizada.wallets)[0];
      abrirApp(email, kind);
    } else mostrarEscolhaCarteira(email);
    return null;
  },

  adicionarCarteira(email, perfil) {
    const usuarios = Auth.usuarios();
    const conta = usuarios[email];
    if (!conta) return 'Não foi possível localizar esta conta.';
    const wallets = carteirasDaConta(conta);
    if (wallets[perfil.kind]) return 'Esta carteira já está cadastrada.';
    const documento = apenasDigitos(perfil.document);
    const duplicado = Object.values(usuarios).some((outraConta) =>
      Object.values(carteirasDaConta(outraConta)).some((carteira) => apenasDigitos(carteira.document) === documento));
    if (duplicado) return 'Já existe uma carteira com este CPF ou CNPJ.';
    wallets[perfil.kind] = {
      name: perfil.name,
      document: documento,
      tradeName: perfil.tradeName || '',
      regime: perfil.kind === 'cnpj' ? perfil.regime : '',
    };
    conta.walletChoiceAsked = true;
    conta.lastWallet = perfil.kind;
    Armazenamento.salvar('fin:users', usuarios);
    Armazenamento.salvar(chaveDados(email, perfil.kind), dadosVazios(perfil.kind));
    return null;
  },

  async entrarDemo(kind) {
    const empresa = kind === 'cnpj';
    const email = empresa ? 'demo.empresa@exemplo.com' : 'demo@exemplo.com';
    const senha = 'demo1234';
    if (!Auth.usuarios()[email]) {
      const erro = await Auth.cadastrar({
        name: empresa ? 'Oficina do Bairro LTDA' : 'Conta de demonstração',
        kind: empresa ? 'cnpj' : 'cpf',
        document: empresa ? '11222333000181' : '11144477735',
        tradeName: empresa ? 'Oficina do Bairro' : '',
        regime: empresa ? 'simples' : '',
      }, email, senha);
      if (erro) return erro;
      Armazenamento.salvar(chaveDados(email, empresa ? 'cnpj' : 'cpf'), dadosDemo(empresa ? 'cnpj' : 'cpf'));
    }
    return Auth.entrar(email, senha);
  },
};

function dadosDemo(kind) {
  const mesAtual = HOJE.slice(0, 7);
  const dia = (n, numero) => somarMesesAnoMes(mesAtual, n) + '-' + String(numero).padStart(2, '0');
  if (kind === 'cnpj') return dadosDemoEmpresa(dia);
  return dadosDemoPessoa(dia);
}

function dadosDemoPessoa(dia) {
  let seq = 0;
  const tx = (desc, amount, type, cat, date, rec) => ({ id: 'd' + seq++, desc, amount, type, cat, date, rec: !!rec, contactId: '' });
  return {
    tx: [
      tx('Salário', 3500, 'income', 'Salário', dia(-3, 5), true),
      tx('Aluguel', 1000, 'expense', 'Moradia', dia(-3, 5), true),
      tx('Mercado', 420, 'expense', 'Alimentação', dia(-2, 5)),
      tx('Mercado', 380, 'expense', 'Alimentação', dia(-1, 5)),
      tx('Mercado', 310, 'expense', 'Alimentação', dia(0, 5)),
      tx('Combustível', 250, 'expense', 'Transporte', dia(-1, 5)),
      tx('Cinema', 60, 'expense', 'Lazer', dia(0, 5)),
      tx('Freela de TI', 600, 'income', 'Outros', dia(-1, 5)),
      tx('Curso online', 300, 'expense', 'Educação', dia(0, 5)),
    ],
    budgets: { Alimentação: 800, Lazer: 200, Transporte: 300 },
    goals: [{ id: 'g1', name: 'Reserva de emergência', target: 5000, saved: 1200 }],
    contacts: [],
    bills: [],
    tax: { rate: 0, das: 0 },
  };
}

function dadosDemoEmpresa(dia) {
  const vencido = (() => {
    const [ano, mes, numero] = HOJE.split('-').map(Number);
    const base = new Date(ano, mes - 1, numero - 4);
    return montarData(base.getFullYear(), base.getMonth() + 1, base.getDate());
  })();
  return {
    tx: [
      { id: 'e1', desc: 'Revisão completa', amount: 1800, type: 'income', cat: 'Serviços', date: dia(-1, 8), rec: false, contactId: 'c1' },
      { id: 'e2', desc: 'Funilaria', amount: 920, type: 'income', cat: 'Serviços', date: dia(-2, 12), rec: false, contactId: 'c1' },
      { id: 'e3', desc: 'Venda de peças', amount: 640, type: 'income', cat: 'Vendas', date: dia(0, 3), rec: false, contactId: 'c2' },
      { id: 'e4', desc: 'Troca de óleo', amount: 350, type: 'income', cat: 'Serviços', date: dia(0, 6), rec: false, contactId: 'c2' },
      { id: 'e5', desc: 'Pintura de para-choque', amount: 1500, type: 'income', cat: 'Serviços', date: dia(0, 10), rec: false, contactId: 'c1' },
      { id: 'e11', desc: 'Alinhamento e balanceamento', amount: 1800, type: 'income', cat: 'Serviços', date: dia(0, 15), rec: false, contactId: 'c2' },
      { id: 'e6', desc: 'Compra de peças', amount: 900, type: 'expense', cat: 'Fornecedores', date: dia(0, 2), rec: false, contactId: 'c3' },
      { id: 'e12', desc: 'Contrato de manutenção da frota', amount: 1800, type: 'income', cat: 'Serviços', date: dia(-3, 10), rec: true, contactId: 'c2' },
      { id: 'e7', desc: 'Aluguel do ponto', amount: 1200, type: 'expense', cat: 'Aluguel', date: dia(-3, 5), rec: true, contactId: '' },
      { id: 'e8', desc: 'Pró-labore', amount: 1500, type: 'expense', cat: 'Pró-labore', date: dia(-3, 5), rec: true, contactId: '' },
      { id: 'e9', desc: 'Anúncio no bairro', amount: 150, type: 'expense', cat: 'Marketing', date: dia(0, 4), rec: false, contactId: '' },
      { id: 'e10', desc: 'Taxa da maquininha', amount: 48, type: 'expense', cat: 'Taxas', date: dia(-1, 20), rec: false, contactId: '' },
    ],
    budgets: { Fornecedores: 1500, Marketing: 400, 'Pró-labore': 1500 },
    goals: [],
    contacts: [
      { id: 'c1', name: 'Ana Souza', role: 'cliente', phone: '(11) 98888-1001' },
      { id: 'c2', name: 'Mercado do João', role: 'cliente', phone: '' },
      { id: 'c3', name: 'Tintas Brasil', role: 'fornecedor', phone: '(11) 3333-2002' },
    ],
    bills: [
      { id: 'b1', kind: 'receber', desc: 'Funilaria — saldo', amount: 450, due: dia(0, 28), cat: 'Serviços', contactId: 'c1', status: 'open' },
      { id: 'b2', kind: 'pagar', desc: 'Tinta automotiva', amount: 320, due: vencido, cat: 'Fornecedores', contactId: 'c3', status: 'open' },
      { id: 'b3', kind: 'pagar', desc: 'Energia do ponto', amount: 280, due: dia(0, 26), cat: 'Aluguel', contactId: '', status: 'open' },
    ],
    tax: { rate: 6, das: 0 },
  };
}

function perfilAtual() {
  const conta = (estado.usuario && Auth.usuarios()[estado.usuario]) || {};
  const kind = estado.tipoCarteiraAtual;
  const perfil = perfilDaConta(conta, kind);
  perfil.name = perfil.name || estado.usuario || '';
  return perfil;
}

const ehEmpresa = () => perfilAtual().kind === 'cnpj';

function nomeContato(id) {
  if (!id || !estado.dados) return '';
  const contato = estado.dados.contacts.find((item) => item.id === id);
  return contato ? contato.name : '';
}

function abrirApp(email, kind) {
  const conta = prepararConta(email);
  if (!conta) return;
  const tipo = conta.wallets[kind] ? kind : Object.keys(conta.wallets)[0];
  estado.usuario = email;
  estado.tipoCarteiraAtual = tipo;
  conta.walletChoiceAsked = true;
  conta.lastWallet = tipo;
  const usuarios = Auth.usuarios();
  usuarios[email] = conta;
  Armazenamento.salvar('fin:users', usuarios);
  Sessao.gravar(email);
  const perfil = perfilAtual();
  estado.dados = normalizarDados(Armazenamento.ler(chaveDados(email, perfil.kind)), perfil.kind);
  salvarDados();

  $('#auth').hidden = true;
  $('#carteiraInicial').hidden = true;
  $('#app').hidden = false;
  $('#mes').value = HOJE.slice(0, 7);
  $('#trData').value = HOJE;
  $('#contaVenc').value = HOJE;
  aplicarVisao();
  renderizar();
}

function mostrarEscolhaCarteira(email, tipoInicial) {
  estado.usuario = email;
  estado.tipoCarteiraPendente = null;
  Sessao.gravar(email);
  $('#auth').hidden = true;
  $('#app').hidden = true;
  $('#carteiraInicial').hidden = false;
  $('#opcoesCarteiraInicial').hidden = false;
  $('#formNovaCarteira').hidden = true;
  $('#sairEscolhaCarteira').hidden = false;
  $('#novaCarteiraMsg').textContent = '';
  if (tipoInicial) abrirFormularioCarteira(tipoInicial);
}

function abrirFormularioCarteira(kind) {
  estado.tipoCarteiraPendente = kind === 'cnpj' ? 'cnpj' : 'cpf';
  const empresa = estado.tipoCarteiraPendente === 'cnpj';
  $('#opcoesCarteiraInicial').hidden = true;
  $('#formNovaCarteira').hidden = false;
  $('#tituloNovaCarteira').textContent = empresa ? 'Carteira da empresa' : 'Carteira pessoal';
  $('#labelNovoNome').textContent = empresa ? 'Razão social' : 'Nome completo';
  $('#novoNome').placeholder = empresa ? 'Ex.: Oficina do Bairro LTDA' : 'Ex.: Ana Souza';
  $('#labelNovoDocumento').textContent = empresa ? 'CNPJ' : 'CPF';
  $('#novoDocumento').placeholder = empresa ? '00.000.000/0000-00' : '000.000.000-00';
  $('#campoNovoFantasia').hidden = !empresa;
  $('#campoNovoRegime').hidden = !empresa;
  $('#novaCarteiraMsg').textContent = '';
  $('#novoNome').value = '';
  $('#novoDocumento').value = '';
  $('#novoFantasia').value = '';
}

function escolherCarteira(kind) {
  const email = estado.usuario;
  const conta = prepararConta(email);
  if (!conta) return;
  const tipo = kind === 'cnpj' ? 'cnpj' : 'cpf';
  if (conta.wallets[tipo]) {
    conta.walletChoiceAsked = true;
    conta.lastWallet = tipo;
    const usuarios = Auth.usuarios();
    usuarios[email] = conta;
    Armazenamento.salvar('fin:users', usuarios);
    abrirApp(email, tipo);
  } else abrirFormularioCarteira(tipo);
}

function criarCarteiraSelecionada() {
  const email = estado.usuario;
  const kind = estado.tipoCarteiraPendente;
  const nome = $('#novoNome').value.trim();
  const documento = apenasDigitos($('#novoDocumento').value);
  const msg = $('#novaCarteiraMsg');
  if (!kind) return;
  if (!nome) {
    msg.textContent = kind === 'cnpj' ? 'Informe a razão social.' : 'Informe seu nome.';
    return;
  }
  if (kind === 'cpf' && !validarCPF(documento)) {
    msg.textContent = 'CPF inválido. Confira os números.';
    return;
  }
  if (kind === 'cnpj' && !validarCNPJ(documento)) {
    msg.textContent = 'CNPJ inválido. Confira os números.';
    return;
  }
  const erro = Auth.adicionarCarteira(email, {
    name: nome,
    kind,
    document: documento,
    tradeName: $('#novoFantasia').value.trim(),
    regime: $('#novoRegime').value,
  });
  if (erro) {
    msg.textContent = erro;
    return;
  }
  abrirApp(email, kind);
}

function alternarCarteira(kind) {
  if (!estado.usuario || kind === estado.tipoCarteiraAtual) return;
  const conta = prepararConta(estado.usuario);
  if (conta && conta.wallets[kind]) abrirApp(estado.usuario, kind);
  else mostrarEscolhaCarteira(estado.usuario, kind);
}

function sair() {
  Sessao.gravar(null);
  estado.usuario = null;
  estado.dados = null;
  Object.values(estado.graficos).forEach((grafico) => grafico.destroy());
  estado.graficos = {};
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#carteiraInicial').hidden = true;
  $('#authSenha').value = '';
}

function aplicarVisao() {
  const empresa = ehEmpresa();
  const perfil = perfilAtual();
  document.querySelectorAll('[data-visao]').forEach((el) => {
    el.hidden = el.dataset.visao !== (empresa ? 'pj' : 'pf');
  });

  const fantasia = perfil.tradeName || perfil.name;
  const documento = perfil.document ? formatarDocumento(perfil.document, perfil.kind) : '';
  $('#saudacao').textContent = 'Olá, ' + fantasia;
  $('#seloCarteira').textContent = empresa ? 'CNPJ' : 'CPF';
  $('#seloCarteira').className = empresa ? 'selo' : 'selo pf';
  if (empresa) {
    const partes = perfil.tradeName ? [perfil.name] : [];
    if (documento) partes.push(documento);
    if (REGIMES[perfil.regime]) partes.push(REGIMES[perfil.regime]);
    $('#subtitulo').textContent = partes.join(' · ');
  } else {
    $('#subtitulo').textContent = documento ? 'Carteira pessoal · ' + documento : 'Carteira pessoal';
  }

  $('#rotSaldo').textContent = empresa ? 'Saldo em caixa' : 'Saldo acumulado';
  $('#rotEntrada').textContent = empresa ? 'Faturamento do mês' : 'Receitas do mês';
  $('#rotSaida').textContent = empresa ? 'Custos do mês' : 'Despesas do mês';
  $('#rotResultado').textContent = empresa ? 'Lucro do mês' : 'Resultado do mês';
  $('#tituloGrafico').textContent = empresa
    ? 'Faturamento e custos nos últimos 6 meses'
    : 'Receitas e despesas nos últimos 6 meses';
  $('#tituloCategorias').textContent = empresa ? 'Custos por categoria' : 'Despesas por categoria';
  $('#tituloOrcamento').textContent = empresa ? 'Teto de gastos por categoria' : 'Orçamento por categoria';
  $('#tituloTabela').textContent = empresa ? 'Movimento de caixa do mês' : 'Transações do mês';
  document.querySelectorAll('[data-alternar-carteira]').forEach((botao) => {
    botao.classList.toggle('on', botao.dataset.alternarCarteira === perfil.kind);
  });
  $('#trDescricao').placeholder = empresa ? 'Ex.: Venda no balcão' : 'Ex.: Mercado';
  $('#semCategorias').textContent = empresa ? 'Nenhum custo neste mês.' : 'Nenhuma despesa neste mês.';
  $('#semTransacoes').textContent = empresa
    ? 'Nenhum lançamento neste mês.'
    : 'Nada por aqui ainda. Adicione o primeiro lançamento acima.';
  $('#trTipo').options[0].text = empresa ? 'Custo / despesa' : 'Despesa';
  $('#trTipo').options[1].text = empresa ? 'Faturamento' : 'Receita';
  $('#filtroTipo').options[1].text = empresa ? 'Faturamento' : 'Receitas';
  $('#filtroTipo').options[2].text = empresa ? 'Custos' : 'Despesas';

  $('#categorias').innerHTML = CATEGORIAS[perfil.kind]
    .map((categoria) => `<option value="${escapar(categoria)}"></option>`)
    .join('');

  const colunaContato = empresa ? '<th>Contato</th>' : '';
  $('#cabecaTabela').innerHTML = `<tr><th>Data</th><th>Descrição</th>${colunaContato}<th>Categoria</th><th style="text-align:right">Valor</th><th></th></tr>`;
  document.title = empresa ? 'Controle Financeiro — Empresa' : 'Controle Financeiro';
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

  contasAbertas(kind) {
    return estado.dados.bills.filter((conta) => conta.status === 'open' && (!kind || conta.kind === kind));
  },

  somaContas(lista) {
    return lista.reduce((soma, conta) => soma + conta.amount, 0);
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
      const kind = estado.tipoCadastro;
      const documento = apenasDigitos($('#authDocumento').value);
      if (!nome) return kind === 'cnpj' ? 'Informe a razão social.' : 'Informe seu nome.';
      if (kind === 'cpf' && !validarCPF(documento)) return 'CPF inválido. Confira os números.';
      if (kind === 'cnpj' && !validarCNPJ(documento)) return 'CNPJ inválido. Confira os números.';
      const erro = await Auth.cadastrar({
        name: nome,
        kind,
        document: documento,
        tradeName: $('#authFantasia').value.trim(),
        regime: $('#authRegime').value,
      }, email, senha);
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
  $('#blocoCadastro').hidden = modo === 'entrar';
  $('#authEnviar').textContent = modo === 'entrar' ? 'Entrar' : 'Criar conta';
  $('#authSenha').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
  $('#authMsg').textContent = '';
}

function trocarTipo(tipo) {
  estado.tipoCadastro = tipo === 'cnpj' ? 'cnpj' : 'cpf';
  const empresa = estado.tipoCadastro === 'cnpj';
  document.querySelectorAll('#tipoCarteira button').forEach((botao) => {
    botao.classList.toggle('on', botao.dataset.tipo === estado.tipoCadastro);
  });
  $('#labelNome').textContent = empresa ? 'Razão social' : 'Nome completo';
  $('#authNome').placeholder = empresa ? 'Ex.: Oficina do Bairro LTDA' : 'Ex.: Ana Souza';
  $('#campoFantasia').hidden = !empresa;
  $('#campoRegime').hidden = !empresa;
  $('#labelDocumento').textContent = empresa ? 'CNPJ' : 'CPF';
  $('#authDocumento').placeholder = empresa ? '00.000.000/0000-00' : '000.000.000-00';
  $('#authDocumento').value = mascararDocumento($('#authDocumento').value, estado.tipoCadastro);
  $('#authMsg').textContent = '';
}

function adicionarTransacao() {
  const desc = $('#trDescricao').value.trim();
  const amount = parseFloat($('#trValor').value);
  const cat = $('#trCategoria').value.trim();
  const date = $('#trData').value;
  const type = $('#trTipo').value;
  const rec = $('#trRepeticao').value === 'mensal';
  const parcelas = parseInt($('#trParcelas').value, 10) || 1;
  const contactId = ehEmpresa() ? $('#trContato').value : '';
  const msg = $('#trMsg');

  if (!desc || !cat || !date || !(amount > 0)) return (msg.textContent = 'Preencha descrição, valor, categoria e data.');
  if (rec && parcelas > 1) return (msg.textContent = 'Escolha entre lançamento mensal fixo ou parcelado, não os dois.');
  msg.textContent = '';

  if (parcelas > 1) {
    const valorParcela = Math.round((amount / parcelas) * 100) / 100;
    for (let i = 0; i < parcelas; i++) {
      estado.dados.tx.push({
        id: gerarId(),
        desc: `${desc} (${i + 1}/${parcelas})`,
        amount: valorParcela,
        type,
        cat,
        date: somarMeses(date, i),
        rec: false,
        contactId,
      });
    }
  } else {
    estado.dados.tx.push({ id: gerarId(), desc, amount, type, cat, date, rec, contactId });
  }
  salvarDados();
  ['#trDescricao', '#trValor', '#trCategoria', '#trParcelas'].forEach((s) => { $(s).value = ''; });
  if (ehEmpresa()) $('#trContato').value = '';
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

function adicionarConta() {
  const desc = $('#contaDesc').value.trim();
  const amount = parseFloat($('#contaValor').value);
  const due = $('#contaVenc').value;
  const cat = $('#contaCat').value.trim();
  const kind = $('#contaTipo').value;
  const contactId = $('#contaContato').value;
  const msg = $('#contaMsg');

  if (!desc || !cat || !due || !(amount > 0)) {
    msg.textContent = 'Preencha descrição, valor, categoria e vencimento.';
    return;
  }
  msg.textContent = '';
  estado.dados.bills.push({ id: gerarId(), kind, desc, amount, due, cat, contactId, status: 'open' });
  salvarDados();
  ['#contaDesc', '#contaValor', '#contaCat'].forEach((s) => { $(s).value = ''; });
  $('#contaContato').value = '';
  renderizar();
}

function adicionarContato() {
  const name = $('#ctNome').value.trim();
  const role = $('#ctTipo').value === 'fornecedor' ? 'fornecedor' : 'cliente';
  const phone = $('#ctFone').value.trim();
  const msg = $('#ctMsg');
  if (!name) {
    msg.textContent = 'Informe o nome do contato.';
    return;
  }
  msg.textContent = '';
  estado.dados.contacts.push({ id: gerarId(), name, role, phone });
  salvarDados();
  $('#ctNome').value = '';
  $('#ctFone').value = '';
  renderizar();
}

function baixarConta(id) {
  const conta = estado.dados.bills.find((item) => item.id === id);
  const msg = $('#contaMsg');
  if (!conta || conta.status !== 'open') return;
  const txId = gerarId();
  estado.dados.tx.push({
    id: txId,
    desc: conta.desc,
    amount: conta.amount,
    type: conta.kind === 'receber' ? 'income' : 'expense',
    cat: conta.cat,
    date: HOJE,
    rec: false,
    contactId: conta.contactId || '',
    billId: conta.id,
  });
  conta.status = 'paid';
  conta.paidAt = HOJE;
  conta.txId = txId;
  salvarDados();
  renderizar();
  $('#contaMsg').textContent = conta.kind === 'receber'
    ? 'Recebimento lançado no caixa de hoje.'
    : 'Pagamento lançado no caixa de hoje.';
  void msg;
}

function lancarImposto() {
  const msg = $('#taxMsg');
  const anoMes = $('#mes').value || HOJE.slice(0, 7);
  const mei = perfilAtual().regime === 'mei';
  let amount = 0;
  let taxMark = 'aliquota';
  let desc = 'Reserva de impostos';

  if (mei) {
    amount = Math.round((parseFloat($('#taxDas').value) || 0) * 100) / 100;
    taxMark = 'das';
    desc = 'DAS do mês';
    estado.dados.tax.das = amount;
  } else {
    const rate = parseFloat($('#taxRate').value);
    if (!(rate >= 0 && rate <= 100)) {
      msg.textContent = 'Informe uma alíquota entre 0 e 100.';
      return;
    }
    estado.dados.tax.rate = rate;
    const faturamento = Calculos.total(Calculos.doMes(anoMes), 'income');
    amount = Math.round((faturamento * rate)) / 100;
    desc = `Reserva de impostos (${String(rate).replace('.', ',')}% do faturamento)`;
  }

  if (!(amount > 0)) {
    msg.textContent = mei
      ? 'Informe o valor da guia.'
      : 'Não há faturamento neste mês para reservar.';
    return;
  }
  const jaLancado = estado.dados.tx.some((t) => t.taxMark === taxMark && t.date.slice(0, 7) === anoMes);
  if (jaLancado) {
    msg.textContent = 'Este mês já tem esse lançamento de imposto. Exclua o anterior para lançar de novo.';
    return;
  }

  estado.dados.tx.push({
    id: gerarId(),
    desc,
    amount,
    type: 'expense',
    cat: 'Impostos',
    date: anoMes === HOJE.slice(0, 7) ? HOJE : anoMes + '-01',
    rec: false,
    contactId: '',
    taxMark,
  });
  salvarDados();
  msg.textContent = '';
  renderizar();
}

function tratarCliqueAcao(evento) {
  const botao = evento.target.closest('[data-acao]');
  if (!botao || !estado.dados) return;
  const { acao, id } = botao.dataset;
  const d = estado.dados;

  if (acao === 'excluir-tx') {
    const lancamento = d.tx.find((t) => t.id === id);
    if (lancamento && lancamento.billId) {
      const conta = d.bills.find((item) => item.id === lancamento.billId);
      if (conta && conta.status === 'paid') {
        conta.status = 'open';
        delete conta.paidAt;
        delete conta.txId;
      }
    }
    d.tx = d.tx.filter((t) => t.id !== id);
  } else if (acao === 'excluir-orc') delete d.budgets[id];
  else if (acao === 'excluir-meta') d.goals = d.goals.filter((g) => g.id !== id);
  else if (acao === 'excluir-conta') d.bills = d.bills.filter((conta) => conta.id !== id);
  else if (acao === 'excluir-contato') {
    d.contacts = d.contacts.filter((contato) => contato.id !== id);
  } else if (acao === 'cancelar-conta') {
    const conta = d.bills.find((item) => item.id === id);
    if (conta && conta.status === 'open') conta.status = 'cancelled';
  } else if (acao === 'baixar-conta') {
    baixarConta(id);
    return;
  } else if (acao === 'guardar') {
    const valor = parseFloat(document.getElementById('guardar-' + id).value);
    if (!(valor > 0)) return;
    d.goals.find((g) => g.id === id).saved += valor;
  } else return;

  salvarDados();
  renderizar();
}

function preencherSelecaoContatos(select) {
  const atual = select.value;
  const contatos = estado.dados.contacts.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  select.innerHTML = '<option value="">Nenhum</option>' + contatos.map((contato) => {
    const papel = contato.role === 'fornecedor' ? 'fornecedor' : 'cliente';
    return `<option value="${contato.id}">${escapar(contato.name)} (${papel})</option>`;
  }).join('');
  if ([...select.options].some((opcao) => opcao.value === atual)) select.value = atual;
}

function renderizar() {
  const anoMes = $('#mes').value || HOJE.slice(0, 7);
  const lista = Calculos.doMes(anoMes);
  renderizarResumo(anoMes, lista);
  renderizarTabela(lista);
  renderizarOrcamentos(lista);
  renderizarMetas();
  if (ehEmpresa()) {
    preencherSelecaoContatos($('#trContato'));
    preencherSelecaoContatos($('#contaContato'));
    renderizarContas();
    renderizarContatos(anoMes);
    renderizarImposto(anoMes);
  }
  Graficos.desenhar(anoMes, lista);
}

function renderizarResumo(anoMes, lista) {
  const receitas = Calculos.total(lista, 'income');
  const despesas = Calculos.total(lista, 'expense');
  const saldo = Calculos.saldoAcumulado(anoMes);
  $('#resAcumulado').textContent = REAL.format(saldo);
  $('#resReceitas').textContent = REAL.format(receitas);
  $('#resDespesas').textContent = REAL.format(despesas);
  const resultado = $('#resResultado');
  resultado.textContent = REAL.format(receitas - despesas);
  resultado.className = receitas - despesas < 0 ? 'exp' : 'inc';

  if (!ehEmpresa()) return;
  const aReceber = Calculos.contasAbertas('receber');
  const aPagar = Calculos.contasAbertas('pagar');
  const receber = Calculos.somaContas(aReceber);
  const pagar = Calculos.somaContas(aPagar);
  const atraso = Calculos.somaContas(aReceber.filter((conta) => conta.due < HOJE));
  const atrasoPagar = Calculos.somaContas(aPagar.filter((conta) => conta.due < HOJE));
  const projetado = saldo + receber - pagar;
  $('#resReceber').textContent = REAL.format(receber);
  $('#resPagar').textContent = REAL.format(pagar);
  $('#resAtraso').hidden = atraso <= 0;
  $('#resAtraso').textContent = atraso > 0 ? REAL.format(atraso) + ' em atraso' : '';
  $('#resAtrasoPagar').hidden = atrasoPagar <= 0;
  $('#resAtrasoPagar').textContent = atrasoPagar > 0 ? REAL.format(atrasoPagar) + ' em atraso' : '';
  const caixa = $('#resProjetado');
  caixa.textContent = REAL.format(projetado);
  caixa.className = projetado < 0 ? 'exp' : 'inc';
  $('#resMargem').textContent = receitas > 0
    ? ((receitas - despesas) / receitas * 100).toFixed(1).replace('.', ',') + '%'
    : '—';
}

function renderizarTabela(lista) {
  const busca = $('#filtroBusca').value.toLowerCase();
  const tipo = $('#filtroTipo').value;
  const empresa = ehEmpresa();
  const linhas = lista
    .filter((t) => (!tipo || t.type === tipo) && (!busca || (t.desc + ' ' + t.cat + ' ' + nomeContato(t.contactId)).toLowerCase().includes(busca)))
    .sort((a, b) => b.date.localeCompare(a.date));

  $('#corpoTabela').innerHTML = linhas.map((t) => {
    const data = t.rec ? 'Mensal' : dataPorExtenso(t.date);
    const classe = t.type === 'income' ? 'inc' : 'exp';
    const sinal = t.type === 'income' ? '+' : '−';
    const contato = empresa ? `<td>${escapar(nomeContato(t.contactId) || '—')}</td>` : '';
    return `<tr>
      <td>${data}</td><td>${escapar(t.desc)}</td>${contato}<td>${escapar(t.cat)}</td>
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
  const vazio = ehEmpresa()
    ? 'Defina um teto mensal para um custo, como fornecedores ou marketing.'
    : 'Defina um limite mensal para uma categoria e acompanhe o gasto.';

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
  }).join('') : `<p class="empty">${vazio}</p>`;
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

function rotuloConta(conta) {
  if (conta.status === 'paid') return conta.kind === 'receber' ? 'Recebida' : 'Paga';
  if (conta.status === 'cancelled') return 'Cancelada';
  if (conta.due < HOJE) return 'Atrasada';
  return 'Em aberto';
}

function classeConta(conta) {
  if (conta.status === 'paid' || conta.status === 'cancelled') return 'paid';
  if (conta.due < HOJE) return 'late';
  return 'open';
}

function renderizarContas() {
  const anoMes = $('#mes').value || HOJE.slice(0, 7);
  const contas = estado.dados.bills
    .filter((conta) => conta.status === 'open' || conta.due.slice(0, 7) === anoMes || (conta.paidAt || '').slice(0, 7) === anoMes)
    .sort((a, b) => a.due.localeCompare(b.due) || a.desc.localeCompare(b.desc, 'pt-BR'));

  $('#listaContas').innerHTML = contas.length ? contas.map((conta) => {
    const contato = nomeContato(conta.contactId);
    const aberta = conta.status === 'open';
    const acoes = aberta
      ? `<button type="button" class="ghost mini" data-acao="baixar-conta" data-id="${conta.id}">Dar baixa</button>
         <button type="button" class="ghost mini" data-acao="cancelar-conta" data-id="${conta.id}">Cancelar</button>`
      : '';
    return `<div class="item">
      <div class="h">
        <span><b>${escapar(conta.desc)}</b> <span class="badge ${classeConta(conta)}">${rotuloConta(conta)}</span></span>
        <span class="${conta.kind === 'receber' ? 'inc' : 'exp'}">${conta.kind === 'receber' ? '+' : '−'} ${REAL.format(conta.amount)}</span>
      </div>
      <small class="empty">Vence em ${dataPorExtenso(conta.due)} · ${escapar(conta.cat)}${contato ? ' · ' + escapar(contato) : ''}${conta.paidAt ? ' · baixa em ' + dataPorExtenso(conta.paidAt) : ''}</small>
      <div class="acoes">
        ${acoes}
        <button type="button" class="x" data-acao="excluir-conta" data-id="${conta.id}" aria-label="Excluir conta ${escapar(conta.desc)}">✕</button>
      </div>
    </div>`;
  }).join('') : '<p class="empty">Nenhuma conta em aberto nem com vencimento neste mês.</p>';
}

function renderizarContatos(anoMes) {
  const lista = Calculos.doMes(anoMes);
  const contatos = estado.dados.contacts.slice().sort((a, b) => {
    if (a.role !== b.role) return a.role === 'cliente' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  $('#listaContatos').innerHTML = contatos.length ? contatos.map((contato) => {
    const doContato = lista.filter((t) => t.contactId === contato.id);
    const valor = contato.role === 'fornecedor'
      ? Calculos.total(doContato, 'expense')
      : Calculos.total(doContato, 'income');
    const legenda = contato.role === 'fornecedor' ? 'compras no mês' : 'faturamento no mês';
    const papel = contato.role === 'fornecedor' ? 'Fornecedor' : 'Cliente';
    return `<div class="item">
      <div class="h"><b>${escapar(contato.name)}</b>
        <span><button class="x" data-acao="excluir-contato" data-id="${contato.id}" aria-label="Excluir ${escapar(contato.name)}">✕</button></span></div>
      <small class="empty">${papel}${contato.phone ? ' · ' + escapar(contato.phone) : ''} · ${legenda}: ${REAL.format(valor)}</small>
    </div>`;
  }).join('') : '<p class="empty">Cadastre quem compra de você e quem vende para a empresa.</p>';
}

function renderizarImposto(anoMes) {
  const mei = perfilAtual().regime === 'mei';
  $('#taxMei').hidden = !mei;
  $('#taxAliquota').hidden = mei;
  if (document.activeElement !== $('#taxDas') && mei) {
    $('#taxDas').value = estado.dados.tax.das ? String(estado.dados.tax.das) : '';
  }
  if (document.activeElement !== $('#taxRate') && !mei) {
    $('#taxRate').value = String(estado.dados.tax.rate);
  }
  if (!mei) {
    const rate = parseFloat($('#taxRate').value);
    const aliquota = rate >= 0 && rate <= 100 ? rate : estado.dados.tax.rate;
    const faturamento = Calculos.total(Calculos.doMes(anoMes), 'income');
    const estimado = faturamento * (aliquota || 0) / 100;
    $('#taxEstimado').textContent = `Sobre ${REAL.format(faturamento)} de faturamento, a reserva estimada é ${REAL.format(estimado)}.`;
  }
  $('#taxLancar').textContent = mei ? 'Lançar DAS no mês selecionado' : 'Lançar reserva no mês selecionado';
}

const Graficos = {
  desenhar(anoMes, lista) {
    if (!window.Chart) return;
    const css = getComputedStyle(document.documentElement);
    const cor = (variavel) => css.getPropertyValue(variavel).trim();
    const eixo = { ticks: { color: cor('--mu') }, grid: { color: cor('--ln') } };
    Object.values(estado.graficos).forEach((g) => g.destroy());
    estado.graficos = {};

    const empresa = ehEmpresa();
    const meses = [-5, -4, -3, -2, -1, 0].map((n) => somarMesesAnoMes(anoMes, n));
    const rotulos = meses.map((m) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
    estado.graficos.barras = new Chart($('#grafBarras'), {
      type: 'bar',
      data: {
        labels: rotulos,
        datasets: [
          { label: empresa ? 'Faturamento' : 'Receitas', data: meses.map((m) => Calculos.total(Calculos.doMes(m), 'income')), backgroundColor: cor('--inc') },
          { label: empresa ? 'Custos' : 'Despesas', data: meses.map((m) => Calculos.total(Calculos.doMes(m), 'expense')), backgroundColor: cor('--exp') },
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
  $('#tipoCarteira').onclick = (evento) => {
    const botao = evento.target.closest('[data-tipo]');
    if (botao) trocarTipo(botao.dataset.tipo);
  };
  $('#authDocumento').addEventListener('input', () => {
    const campo = $('#authDocumento');
    campo.value = mascararDocumento(campo.value, estado.tipoCadastro);
  });
  $('#novoDocumento').addEventListener('input', () => {
    const campo = $('#novoDocumento');
    campo.value = mascararDocumento(campo.value, estado.tipoCarteiraPendente || 'cpf');
  });
  $('#escolherPf').onclick = () => escolherCarteira('cpf');
  $('#escolherPj').onclick = () => escolherCarteira('cnpj');
  $('#criarNovaCarteira').onclick = criarCarteiraSelecionada;
  $('#voltarOpcoesCarteira').onclick = () => mostrarEscolhaCarteira(estado.usuario);
  $('#sairEscolhaCarteira').onclick = sair;
  $('#alternarCarteira').onclick = (evento) => {
    const botao = evento.target.closest('[data-alternar-carteira]');
    if (botao) alternarCarteira(botao.dataset.alternarCarteira);
  };
  $('#authEnviar').onclick = enviarAuth;
  $('#authDemo').onclick = () => Auth.entrarDemo('cpf').then((erro) => { $('#authMsg').textContent = erro || ''; });
  $('#authDemoEmpresa').onclick = () => Auth.entrarDemo('cnpj').then((erro) => { $('#authMsg').textContent = erro || ''; });
  ['#authEmail', '#authSenha', '#authNome', '#authDocumento', '#authFantasia'].forEach((s) =>
    $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarAuth(); }));

  $('#sair').onclick = sair;
  $('#trAdicionar').onclick = adicionarTransacao;
  $('#orcDefinir').onclick = definirOrcamento;
  $('#metaCriar').onclick = criarMeta;
  $('#contaAdicionar').onclick = adicionarConta;
  $('#ctCriar').onclick = adicionarContato;
  $('#taxLancar').onclick = lancarImposto;
  $('#taxRate').addEventListener('change', () => {
    if (!estado.dados || !ehEmpresa()) return;
    const rate = parseFloat($('#taxRate').value);
    if (rate >= 0 && rate <= 100) {
      estado.dados.tax.rate = rate;
      salvarDados();
      renderizarImposto($('#mes').value || HOJE.slice(0, 7));
    }
  });
  $('#taxDas').addEventListener('change', () => {
    if (!estado.dados || !ehEmpresa()) return;
    const das = parseFloat($('#taxDas').value);
    if (das >= 0) {
      estado.dados.tax.das = Math.round(das * 100) / 100;
      salvarDados();
    }
  });
  document.addEventListener('click', tratarCliqueAcao);
  ['#mes', '#filtroBusca', '#filtroTipo'].forEach((s) =>
    $(s).addEventListener('input', () => { if (estado.dados) renderizar(); }));
}

iniciarEventos();
const sessaoSalva = Sessao.ler();
if (sessaoSalva && Auth.usuarios()[sessaoSalva]) {
  const contaSalva = prepararConta(sessaoSalva);
  if (contaSalva.walletChoiceAsked) {
    const tipoSalvo = contaSalva.wallets[contaSalva.lastWallet]
      ? contaSalva.lastWallet
      : Object.keys(contaSalva.wallets)[0];
    abrirApp(sessaoSalva, tipoSalvo);
  } else mostrarEscolhaCarteira(sessaoSalva);
}
