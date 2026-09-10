# Lar em Ordem

Aplicação familiar auto-hospedada. Os dados e os arquivos enviados ficam no volume Docker `lar-em-ordem-data`, e não no navegador.

## Rodar no home lab

1. Instale Docker e Docker Compose.
2. Nesta pasta, execute `docker compose up -d --build`.
3. Abra `http://SEU-SERVIDOR:3000` e crie a primeira conta de administrador.

Para expor o serviço fora da rede local, coloque-o atrás de um proxy reverso com HTTPS (por exemplo, Caddy ou Nginx Proxy Manager). Não exponha a porta 3000 diretamente à internet.

## Incluído

- Contas/perfis familiares com login por senha.
- Documentos com número, validade e upload para o servidor.
- Receitas: cadastro manual ou importação de um link que ofereça dados Recipe Schema.org.
- Agenda, medicações, aniversários, tarefas, lista de compras e álbuns.
- SQLite e uploads persistidos no volume Docker.
