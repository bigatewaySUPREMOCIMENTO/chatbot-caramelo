// Caramelo da TI 🐶 com GPT-4o integrado para Tira-dúvidas

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const FormData = require('form-data');
const OpenAI = require('openai');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;
const SOFTDESK_API_KEY = process.env.SOFTDESK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sessions = {};
const TEMPO_AVISO_MS = 3 * 60 * 1000;
const TEMPO_LIMITE_MS = 6 * 60 * 1000;

async function sendMessage(userId, message) {
  console.log(`[sendMessage] → ${userId}: ${message}`);
}

async function consultarChamadoPorNumero(numero) {
  const url = `https://suporte.supremocimento.com.br/api/api.php/chamado?codigo=${numero}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'hash_api': SOFTDESK_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    return res.data?.objeto;
  } catch (err) {
    console.error('[Erro ao consultar chamado]', err?.response?.data || err.message);
    throw err;
  }
}

app.post('/webhook', upload.single('evidencia'), async (req, res) => {
  const { userId, message, email, name, channel } = req.body;
  const file = req.file;
  if (!sessions[userId]) sessions[userId] = { step: 0, data: {} };

  if (sessions[userId].limiteTimeout) clearTimeout(sessions[userId].limiteTimeout);
  if (sessions[userId].avisoTimeout) clearTimeout(sessions[userId].avisoTimeout);

  sessions[userId].avisoTimeout = setTimeout(async () => {
    await sendMessage(userId, '⏳ Oi! Ainda tá por aí? Se não responder em 3 minutos, vou encerrar a conversa pra não ficar esperando à toa. 🐶');
  }, TEMPO_AVISO_MS);

  sessions[userId].limiteTimeout = setTimeout(async () => {
    await sendMessage(userId, '⏲️ A conversa foi encerrada por inatividade. Se precisar de algo, é só chamar o Caramelo novamente! 🐾');
    delete sessions[userId];
  }, TEMPO_LIMITE_MS);

  const session = sessions[userId];
  let reply = '';

  try {
    switch (session.step) {
      case 0:
        if (channel === 'teams' && email) {
          session.data.email = email;
          session.data.nome = name.split(' ')[0];
          session.step = 2;
          reply = `Au au, ${session.data.nome}! 🐾 Como posso ajudar hoje?\n1⃣️ Abrir chamado\n2⃣️ Consultar chamado\n3⃣️ Tira-dúvidas (IA)\n4⃣️ Encerrar conversa`;
        } else {
          reply = 'Oi oi! 🐶 Antes de tudo, me diga seu e-mail corporativo, por favor. Assim posso te AUcompanhar melhor! ✨';
          session.step = 1;
        }
        break;

      case 1:
        if (!message.includes('@')) {
          reply = 'E-mail inválido... Tenta de novo, por favor! 🐶';
          break;
        }
        session.data.email = message;
        session.data.nome = message.split('@')[0].split('.')[0];
        session.step = 2;
        reply = `Legal, ${session.data.nome.charAt(0).toUpperCase() + session.data.nome.slice(1)}! 🐾 Como posso ajudar?\n1⃣️ Abrir chamado\n2⃣️ Consultar chamado\n3⃣️ Tira-dúvidas (IA)\n4⃣️ Encerrar conversa`;
        break;

      case 2:
        if (message === '1') {
          session.step = 10;
          reply = 'Beleza! Qual é o título do seu chamado?';
        } else if (message === '2') {
          session.step = 20;
          reply = 'Me diga o número do chamado que você quer consultar:';
        } else if (message === '3') {
          session.step = 200;
          reply = 'Manda sua dúvida técnica aí! O Caramelo vai consultar seus conhecimentos e tentar te ajudar! 💻🐶';
        } else if (message === '4') {
          reply = 'Conversa encerrada. Até logo! 🐾';
          delete sessions[userId];
        } else {
          reply = 'Escolha uma opção válida: 1, 2, 3 ou 4.';
        }
        break;

      case 10:
        session.data.tituloChamado = message;
        session.step = 11;
        reply = 'Agora descreva o problema que você está enfrentando:';
        break;

      case 11:
        const refine = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'Você é um assistente técnico que reescreve descrições de problemas de TI enviadas por usuários. Melhore o texto para que fique claro, objetivo e útil para técnicos de suporte, mantendo o contexto do problema. Todas as descrições devem considerar a versão 5.10.3.116 do ERP Sapiens Senior.'
            },
            {
              role: 'user',
              content: message
            }
          ]
        });

        session.data.descricaoChamado = refine.choices[0].message.content;
        const titulo = session.data.tituloChamado;
        const descricao = session.data.descricaoChamado;
        const emailUsuario = session.data.email;
        const nome = session.data.nome;

        const html = `Nome: ${nome}<br>` +
          `E-mail: ${emailUsuario}<br>` +
          `Título: ${titulo}<br>` +
          `Descrição: ${descricao}`;

        const params = new URLSearchParams({
          cd_area: 1,
          em_usuario: emailUsuario,
          tt_chamado: `[Chatbot] ${titulo}`,
          ds_chamado: html,
          cd_tipo_chamado: 11,
          cd_grupo_solucao: 2,
          cd_servico: 31,
          cd_nivel_indisponibilidade: 7,
          cd_categoria: 4583,
          cd_prioridade: 'Baixa'
        });

        try {
          const url = `https://suporte.supremocimento.com.br/modulos/incidente/api.php?${params.toString()}`;
          const result = await axios.get(url, { headers: { 'X-Api-Key': SOFTDESK_API_KEY } });
          const protocolo = result.data?.cd_chamado || '???';

          reply = `🐾 Prontinho! Seu chamado foi aberto com sucesso!\n📄 Chamado: ${protocolo}\nLogo alguém da equipe técnica entrará em contato. AUbraços! 🐶`;
        } catch {
          reply = 'Houve um erro ao abrir o chamado. Tente novamente mais tarde.';
        }
        delete sessions[userId];
        break;

      case 20:
        const numero = message.trim();
        try {
          const chamado = await consultarChamadoPorNumero(numero);

          if (chamado) {
            const status = chamado.status?.descricao || 'Indefinido';
            const atendente = chamado.atendente?.nome || 'Não atribuído';
            const ultimaAtividade = chamado.atividades?.slice(-1)[0]?.descricao || 'Sem interações recentes';
            const agendamento = chamado.data_termino_previsto ? `${chamado.data_termino_previsto} às ${chamado.hora_termino_previsto}` : 'Não há agendamento';
            const fornecedor = chamado.grupo_solucao?.descricao?.includes('Fornecedor') ? chamado.grupo_solucao.descricao : 'Sem fornecedor atribuído';

            reply =
              `📄 Chamado: ${chamado.codigo}\n` +
              `📌 Status: ${status}\n` +
              `🗓 Agendado para: ${agendamento}\n` +
              `🤝 Atendimento com: ${fornecedor}\n` +
              `🧑‍💼 Atendente: ${atendente}\n` +
              `🕒 Última interação: ${ultimaAtividade}`;
          } else {
            reply = `Não encontrei nenhum chamado com o número ${numero}. Verifique se digitou corretamente.`;
          }
        } catch {
          reply = 'Erro ao consultar o chamado. Tente novamente em instantes.';
        }
        delete sessions[userId];
        break;

      case 200:
        if (!session.data.historicoIA) session.data.historicoIA = [];

        if (file) {
          const ocrResult = await Tesseract.recognize(file.path, 'eng');
          fs.unlinkSync(file.path);
          session.data.historicoIA.push({ role: 'user', content: `${message}\nTexto da imagem: ${ocrResult.data.text}` });
        } else {
          session.data.historicoIA.push({ role: 'user', content: message });
        }

        const chat = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Você é o Caramelo – o Cãopanheiro Fiel da TI 🐾. Mantenha uma postura simpática e proativa, com tom profissional e objetivo. Você está conversando com um colaborador do setor cimenteiro que pode ser técnico ou líder. Sua missão é ajudá-lo com dúvidas de TI de forma clara e eficiente. As respostas devem estar baseadas na versão 5.10.3.116 do ERP Sapiens Senior.

Especialidades:
- Windows 10/11, Office 365, TMS, Power BI
- ERP Sapiens Senior (Compras, Estoque, Faturamento, Financeiro, Integrações)
- HCM Senior (cadastro, ponto, folha, férias, benefícios)
- BPMs e GEDs no Senior X

Mantenha uma conversa contínua: sempre que possível, pergunte de forma objetiva se a dúvida foi resolvida, e se não, continue buscando ajudar. Se o colaborador solicitar abrir chamado ou encerrar, apenas cumpra. Não use menus nem números — apenas interaja naturalmente.`
            },
            ...session.data.historicoIA
          ]
        });

        const respostaIA = chat.choices[0].message.content;
        session.data.historicoIA.push({ role: 'assistant', content: respostaIA });

        if (message.toLowerCase().includes('abrir chamado')) {
          session.step = 10;
          reply = 'Claro! Vamos abrir o chamado. Qual o título que deseja utilizar?';
        } else if (message.toLowerCase().includes('encerrar')) {
          reply = 'Conversa encerrada. Até logo! 🐾';
          delete sessions[userId];
        } else {
          reply = respostaIA;
          session.step = 200;
        }
        break;

      default:
        reply = 'Ops! Não entendi... vamos recomeçar? Me diga seu e-mail por favor. 🐶';
        session.step = 0;
    }
  } catch (err) {
    console.error('[Erro Global]', err);
    reply = 'Opa! Tive um probleminha aqui... Tente novamente em alguns instantes. 🐶';
    delete sessions[userId];
  }

  await sendMessage(userId, reply);
  res.json({ reply });
});

app.listen(PORT, () => {
  console.log(`🚀 Caramelo online e escutando feliz na porta ${PORT}! 🐾`);
});
