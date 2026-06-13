import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const app = express();

app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  cors({
    origin: [
      "https://drlucasgomes.com.br",
      "https://www.drlucasgomes.com.br"
    ],
    methods: ["POST", "GET"]
  })
);

const contatoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Muitas tentativas. Tente novamente mais tarde."
});

function checarVariaveis() {
  const obrigatorias = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_REMETENTE",
    "EMAIL_DESTINO"
  ];

  const faltando = obrigatorias.filter((nome) => !process.env[nome]);

  if (faltando.length > 0) {
    console.error("Variáveis faltando no Render:", faltando);
  } else {
    console.log("Todas as variáveis principais estão configuradas.");
  }
}

checarVariaveis();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function limparTexto(valor, limite = 2000) {
  if (!valor) return "";
  return String(valor).trim().slice(0, limite);
}

function contarLinks(texto) {
  if (!texto) return 0;
  const matches = texto.match(/https?:\/\/|www\.|\.com|\.ru|\.cn|\.xyz|\.top/gi);
  return matches ? matches.length : 0;
}

function pareceSpam({ nome, email, mensagem }) {
  const texto = `${nome} ${email} ${mensagem}`.toLowerCase();

  const palavrasBloqueadas = [
    "casino",
    "viagra",
    "crypto",
    "bitcoin",
    "loan",
    "porn",
    "xxx",
    "seo services",
    "backlinks",
    "telegram",
    "whatsapp marketing",
    "free money",
    "investment opportunity"
  ];

  if (contarLinks(texto) >= 2) return true;
  if (mensagem && mensagem.length > 2000) return true;

  return palavrasBloqueadas.some((palavra) => texto.includes(palavra));
}

function whatsappValido(valor) {
  const somenteNumeros = String(valor || "").replace(/\D/g, "");
  return somenteNumeros.length >= 10 && somenteNumeros.length <= 13;
}

function montarTextoEmail(dados) {
  return `
Novo contato recebido pelo site:

Nome: ${dados.nome}
WhatsApp: ${dados.whatsapp}
E-mail: ${dados.email || "Não informado"}
Cidade: ${dados.cidade || "Não informada"}
Motivo: ${dados.motivo || "Não informado"}

Mensagem:
${dados.mensagem}

IP:
${dados.ip}
  `;
}

function montarHtmlEmail(dados) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2>Novo contato recebido pelo site</h2>

      <p><strong>Nome:</strong> ${dados.nome}</p>
      <p><strong>WhatsApp:</strong> ${dados.whatsapp}</p>
      <p><strong>E-mail:</strong> ${dados.email || "Não informado"}</p>
      <p><strong>Cidade:</strong> ${dados.cidade || "Não informada"}</p>
      <p><strong>Motivo:</strong> ${dados.motivo || "Não informado"}</p>

      <hr>

      <p><strong>Mensagem:</strong></p>
      <p>${dados.mensagem}</p>

      <hr>

      <p style="font-size: 12px; color: #6b7280;">
        IP: ${dados.ip}
      </p>
    </div>
  `;
}

app.get("/", (req, res) => {
  res.send("Servidor do formulário do consultório ativo com Resend.");
});

app.get("/teste-email", async (req, res) => {
  try {
    console.log("Iniciando teste de e-mail via Resend...");
    console.log("EMAIL_REMETENTE:", process.env.EMAIL_REMETENTE);
    console.log("EMAIL_DESTINO:", process.env.EMAIL_DESTINO);

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_REMETENTE,
      to: [process.env.EMAIL_DESTINO],
      subject: "Teste de envio do formulário via Resend",
      text: "Se você recebeu este e-mail, a API do Resend está funcionando."
    });

    if (error) {
      console.error("Erro Resend no teste:", error);
      return res.status(500).send("Erro no teste de e-mail via Resend. Veja os logs.");
    }

    console.log("E-mail de teste enviado via Resend:", data);
    return res.send("E-mail de teste enviado com sucesso via Resend.");
  } catch (err) {
    console.error("Erro geral no teste de e-mail:", err);
    return res.status(500).send("Erro geral no teste de e-mail. Veja os logs.");
  }
});

app.post("/contato", contatoLimiter, async (req, res) => {
  console.log("POST /contato recebido");
  console.log("Body recebido:", req.body);

  try {
    const {
      nome,
      whatsapp,
      email,
      cidade,
      motivo,
      mensagem,
      empresa_site_confirmacao,
      website
    } = req.body;

    // Honeypot: se campo invisível vier preenchido, é provável bot.
    if (empresa_site_confirmacao || website) {
      console.log("Bloqueado por honeypot.");
      return res.send("Envio recebido.");
    }

    const dados = {
      nome: limparTexto(nome, 120),
      whatsapp: limparTexto(whatsapp, 30),
      email: limparTexto(email, 120),
      cidade: limparTexto(cidade, 120),
      motivo: limparTexto(motivo, 80),
      mensagem: limparTexto(mensagem, 2000),
      origem: "site",
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      user_agent: req.headers["user-agent"]
    };

    console.log("Dados tratados:", dados);

    if (!dados.nome || !dados.whatsapp || !dados.mensagem) {
      console.error("Campos obrigatórios ausentes.");
      return res.status(400).send("Preencha nome, WhatsApp e mensagem.");
    }

    if (!whatsappValido(dados.whatsapp)) {
      console.error("WhatsApp inválido:", dados.whatsapp);
      return res.status(400).send("Informe um WhatsApp válido.");
    }

    if (pareceSpam(dados)) {
      console.log("Spam bloqueado:", dados);
      return res.send("Envio recebido.");
    }

    console.log("Tentando salvar no Supabase...");

    const { data, error } = await supabase
      .from("contatos_consultorio")
      .insert([dados])
      .select();

    if (error) {
      console.error("Erro Supabase completo:", error);
      return res.status(500).send("Erro ao salvar contato no Supabase.");
    }

    console.log("Contato salvo no Supabase:", data);

    try {
      console.log("Tentando enviar e-mail via Resend...");

      const emailPayload = {
        from: process.env.EMAIL_REMETENTE,
        to: [process.env.EMAIL_DESTINO],
        subject: `Novo contato do site: ${dados.nome}`,
        text: montarTextoEmail(dados),
        html: montarHtmlEmail(dados)
      };

      if (dados.email) {
        emailPayload.replyTo = dados.email;
      }

      const { data: emailData, error: emailError } = await resend.emails.send(emailPayload);

      if (emailError) {
        console.error("Contato salvo, mas falhou ao enviar via Resend:", emailError);
      } else {
        console.log("E-mail enviado via Resend:", emailData);
      }
    } catch (emailCatchError) {
      console.error("Contato salvo, mas erro geral no envio via Resend:", emailCatchError);
    }

    return res.redirect("https://drlucasgomes.com.br/obrigado-contato");
  } catch (err) {
    console.error("Erro geral completo:", err);
    return res.status(500).send("Erro geral no servidor.");
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
