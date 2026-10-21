
CREATE TABLE IF NOT EXISTS chat_conversations (
    id CHAR(36) NOT NULL PRIMARY KEY,

    created_at DATETIME(6) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(6),

    updated_at DATETIME(6) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS chat_messages (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT
        PRIMARY KEY,

    conversation_id CHAR(36) NOT NULL,

    role ENUM('user', 'assistant') NOT NULL,

    content TEXT NOT NULL,

    created_at DATETIME(6) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_messages_conversation (
        conversation_id,
        id
    ),

    CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id)
        REFERENCES chat_conversations(id)
        ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4;
