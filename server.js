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
    methods: ["POST"]
  })
);

const contatoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Muitas tentativas. Tente novamente mais tarde."
});

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

    // Honeypot: campo invisível. Se vier preenchido, provavelmente é robô.
    if (website) {
      return res.redirect("https://drlucasgomes.com.br/obrigado-contato");
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

    if (!dados.nome || !dados.whatsapp || !dados.mensagem) {
      return res.status(400).send("Preencha nome, WhatsApp e mensagem.");
    }

    if (!whatsappValido(dados.whatsapp)) {
      return res.status(400).send("Informe um WhatsApp válido.");
    }

    if (pareceSpam(dados)) {
      console.log("Spam bloqueado:", dados);
      return res.redirect("https://drlucasgomes.com.br/obrigado-contato");
    }

    const { error } = await supabase
      .from("contatos_consultorio")
      .insert([dados]);

    if (error) {
      console.error("Erro Supabase:", error);
      return res.status(500).send("Erro ao salvar contato.");
    }

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

    return res.redirect("https://drlucasgomes.com.br/obrigado-contato");
  } catch (err) {
    console.error("Erro geral:", err);
    return res.status(500).send("Erro ao enviar contato.");
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
