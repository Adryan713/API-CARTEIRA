CREATE DATABASE IF NOT EXISTS carteira;
USE carteira;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    saldo INT NOT NULL DEFAULT 1000
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transferencias (
    id INT AUTO_INCREMENT PRIMARY KEY,
    origem VARCHAR(50) NOT NULL,
    destino VARCHAR(50) NOT NULL,
    valor INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_dup_check (origem, destino, valor, created_at)
) ENGINE=InnoDB;