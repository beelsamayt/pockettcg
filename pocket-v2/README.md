# PocketTCG — Plataforma de Torneios v2.0

Clone completo do Limitless TCG para Pokémon TCG Pocket.

## Funcionalidades

### Formatos de Match
| Formato | Descrição |
|---------|-----------|
| **Bo1** | Best of 1 — jogo único |
| **Bo3** | Best of 3 — primeiro a 2 vitórias |
| **Bo5** | Best of 5 — primeiro a 3 vitórias |
| **2-Game** | Dois jogos fixos; empate possível |
| **Conquest** | Vence com cada um dos teus decks. Primeiro a conquistar todos ganha |
| **Last Hero Standing** | Perdedor troca de deck. Vencedor mantém. Último deck de pé ganha |
| **Bring 2 Ban 1** | Trazes 2 decks, banes 1 do adversário, Bo3 com o que sobra |
| **Specialist** | Declaras 1 deck antes do match. Jogas Bo3 sem trocar |

### Estrutura de Fases
- **Swiss** — emparelhamento por registo, anti-rematch
- **Single Elimination** — bracket, uma derrota e sais
- **Double Elimination** — bracket com losers bracket
- **Round Robin** — todos contra todos
- Encadeamento ilimitado de fases (ex: Swiss → Top 8 → Top 4 em Bo5)

### Torneio
- OWP tiebreaker (oficial Pokémon TCG)
- Check-in obrigatório com abertura pelo organizador
- Lista de espera automática quando o cap é atingido
- Registo tardio (recebe derrota pelas rondas perdidas)
- Drop de jogadores (em curso → marcado como saído)
- Tipos de acesso: Aberto / Código / Convite

### Decklists
- 1 a 5 decks por jogador (configurável)
- Visibilidade: Aberta / Fechada / Arquétipo público
- Regras extra: Singleton, Monotype, Sem EX

## Instalar

```bash
npm install
node server.js
```
Abre http://localhost:3000

## Deploy

### Railway (recomendado, gratuito)
1. Push para GitHub
2. railway.app → New Project → Deploy from GitHub
3. URL pública automática

### Render
- Build: `npm install`  
- Start: `node server.js`

### VPS com PM2
```bash
npm install -g pm2
pm2 start server.js --name pockettcg
pm2 save && pm2 startup
```

## Variáveis de ambiente
```
PORT=3000
JWT_SECRET=muda-isto-em-producao
```

## Dados
Guardados em `data/tournaments.json` e `data/users.json`.
Para produção considera migrar para SQLite/PostgreSQL.
