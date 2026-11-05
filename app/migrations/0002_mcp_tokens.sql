-- Tokens for the MCP server (/api/mcp), so an AI assistant can act for someone. One per person;
-- only the SHA-256 of the token is kept, so it's shown once, when it's made.
create table mcp_tokens (
  user_id text primary key references "user" ("id") on delete cascade,
  hash text not null unique,
  created_at integer not null,
  last_used_at integer
);
