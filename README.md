Controle Financeiro Avançado

Aplicação web para registrar receitas e despesas, acompanhar o saldo mês a mês e planejar gastos. Projeto acadêmico do curso de Análise e Desenvolvimento de Sistemas.

Demonstração online: https://github.com/natan-sls/Ativ1

Conta de teste: clique em Entrar com conta de demonstração (e-mail demo@exemplo.com, senha demo1234). Ela já vem com dados de exemplo.

Funcionalidades
Login e cadastro, com senha protegida por hash SHA-256 e dados separados por usuário
Receitas e despesas com categoria e data
Lançamentos mensais fixos e parcelamento
Navegação por mês, com saldo acumulado, receitas, despesas e resultado
Orçamento por categoria, com aviso de limite excedido
Metas de economia
Gráficos de receitas x despesas (6 meses) e despesas por categoria
Busca e filtro de transações
Layout responsivo, com tema claro e escuro automático
Tecnologias
HTML5, CSS3 e JavaScript puro
Chart.js 4.4.1, para os gráficos
Web Crypto API, para o hash das senhas
localStorage, para guardar os dados no navegador
Como executar

Não precisa instalar nada. Baixe os arquivos e abra o index.html no navegador, ou acesse a demonstração online. É necessário ter internet para carregar o Chart.js.

Estrutura do projeto
├── index.html
├── style.css 
├── app.js
└── README.md
Limitações

Os dados ficam salvos no navegador de quem usa, sem servidor nem banco de dados. Por isso, o login demonstra o fluxo de autenticação, mas não substitui um sistema com backend. Se o cache for limpo ou o acesso for feito em outro aparelho, as informações não aparecem.

Próximos passos
Backend com banco de dados e autenticação por token
Recuperação de senha
Exportação em CSV ou PDF
Edição de transações
