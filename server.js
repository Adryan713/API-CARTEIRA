const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpassword',
    database: process.env.DB_NAME || 'carteira',
    waitForConnections: true,
    connectionLimit: 30,
    queueLimit: 0
};

let pool;
async function connectDb() {
    while (true) {
        try {
            pool = mysql.createPool(dbConfig);
            await pool.query('SELECT 1');
            console.log('Base de dados ligada com sucesso.');
            break;
        } catch (err) {
            console.log('A aguardar pela base de dados...', err.message);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}
connectDb();

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "NAO_AUTENTICADO" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ error: "NAO_AUTENTICADO" });
        req.user = user;
        next();
    });
}

app.post('/auth/registrar', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(422).json({ error: "DADOS_INVALIDOS" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, saldo) VALUES (?, ?, 1000)',
            [username, hashedPassword]
        );

        return res.status(201).send();
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: "USUARIO_EXISTENTE" });
        }
        return res.status(500).json({ error: "ERRO_INTERNO" });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: "CREDENCIAIS_INVALIDAS" });

        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ error: "CREDENCIAIS_INVALIDAS" });

        const token = jwt.sign({ username: user.username }, JWT_SECRET);
        return res.status(200).json({ token });
    } catch (err) {
        return res.status(500).json({ error: "ERRO_INTERNO" });
    }
});

app.get('/conta', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT username, saldo FROM users WHERE username = ?', [req.user.username]);
        if (rows.length === 0) return res.status(404).json({ error: "USUARIO_INEXISTENTE" });
        return res.status(200).json(rows[0]);
    } catch (err) {
        return res.status(500).json({ error: "ERRO_INTERNO" });
    }
});

app.post('/transferencias', authenticateToken, async (req, res) => {
    const origem = req.user.username;
    const { destino, valor } = req.body;

    if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) {
        return res.status(422).json({ error: "VALOR_INVALIDO" });
    }
    if (destino === origem) {
        return res.status(422).json({ error: "MESMA_CONTA" });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [dupRows] = await connection.query(
            `SELECT id FROM transferencias 
             WHERE origem = ? AND destino = ? AND valor = ? 
             AND created_at >= (NOW(3) - INTERVAL 60 SECOND) 
             LIMIT 1 FOR UPDATE`,
            [origem, destino, valor]
        );

        if (dupRows.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(409).json({ error: "TRANSFERENCIA_DUPLICADA" });
        }

        const [destRows] = await connection.query('SELECT username FROM users WHERE username = ?', [destino]);
        if (destRows.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ error: "DESTINO_INEXISTENTE" });
        }

        const [origemRows] = await connection.query('SELECT saldo FROM users WHERE username = ? FOR UPDATE', [origem]);
        const saldoOrigem = origemRows[0].saldo;

        if (saldoOrigem < valor) {
            await connection.rollback();
            connection.release();
            return res.status(409).json({ error: "SALDO_INSUFICIENTE" });
        }

        await connection.query('UPDATE users SET saldo = saldo - ? WHERE username = ?', [valor, origem]);
        await connection.query('UPDATE users SET saldo = saldo + ? WHERE username = ?', [valor, destino]);

        const [transResult] = await connection.query(
            'INSERT INTO transferencias (origem, destino, valor) VALUES (?, ?, ?)',
            [origem, destino, valor]
        );

        const novoSaldoOrigem = saldoOrigem - valor;

        await connection.commit();
        connection.release();

        return res.status(201).json({
            id: transResult.insertId,
            origem,
            destino,
            valor,
            saldo: novoSaldoOrigem
        });

    } catch (err) {
        await connection.rollback();
        connection.release();
        return res.status(500).json({ error: "ERRO_INTERNO" });
    }
});

app.get('/auditoria', async (req, res) => {
    try {
        const [userCountRows] = await pool.query('SELECT COUNT(*) as usuarios, SUM(saldo) as somaSaldos FROM users');
        const [transCountRows] = await pool.query('SELECT COUNT(*) as transferencias FROM transferencias');

        const usuarios = userCountRows[0].usuarios || 0;
        const somaSaldos = userCountRows[0].somaSaldos !== null ? Number(userCountRows[0].somaSaldos) : 0;
        const transferencias = transCountRows[0].transferencias || 0;

        return res.status(200).json({
            usuarios,
            somaSaldos,
            transferencias
        });
    } catch (err) {
        return res.status(500).json({ error: "ERRO_INTERNO" });
    }
});

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`API Enterprise a executar na porta ${PORT}`);
});