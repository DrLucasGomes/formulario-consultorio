import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";

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
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

app.get("/", (req, res) => {
  res.send("Servidor do formulário do consultório ativo.");
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
      website
    } = req.body;

    if (website) {
      console.log("Bloqueado por honeypot. Campo website preenchido.");
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
      console.log("Tentando enviar e-mail...");
      console.log("SMTP_USER:", process.env.SMTP_USER);
      console.log("EMAIL_DESTINO:", process.env.EMAIL_DESTINO);

      await transporter.sendMail({
        from: `"Site Dr. Lucas" <${process.env.SMTP_USER}>`,
        to: process.env.EMAIL_DESTINO,
        subject: `Novo contato do site: ${dados.nome}`,
        replyTo: dados.email || process.env.SMTP_USER,
        text: `
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
        `
      });

      console.log("E-mail enviado com sucesso.");
    } catch (emailError) {
      console.error("Contato salvo, mas falhou ao enviar e-mail:", emailError);
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
