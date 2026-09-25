-- =====================================================================
-- Segurança (RLS), Realtime (WebSockets) e agendamentos no banco
-- Os workers usam a service_role key (ignora RLS) — nunca exponha no front.
-- =====================================================================

-- Tabelas de leitura pública
do $$
declare t text;
begin
  foreach t in array array[
    'sports','leagues','teams','players','stat_types','bookmakers','games',
    'player_game_stats','live_player_stats','team_defense_vs_position',
    'prop_markets','odds_current','prop_analytics'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

alter table odds_history enable row level security;          -- só service_role

-- Partições são tabelas próprias no PostgREST: fecha acesso direto (consultas pela tabela-mãe seguem funcionando)
do $$
declare r record;
begin
  for r in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
           join pg_class p on p.oid = i.inhparent
           where p.relname in ('player_game_stats','odds_history') loop
    execute format('alter table %I enable row level security', r.relname);
  end loop;
end $$;

-- Premium
alter table ev_alerts enable row level security;
create policy "premium read" on ev_alerts for select to authenticated using (is_premium());

-- Dados do usuário
alter table profiles        enable row level security;
alter table tracked_bets    enable row level security;
alter table bankroll_ledger enable row level security;

create policy "own profile read"   on profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on profiles for update to authenticated using (id = auth.uid());
-- bankroll/plano só mudam via funções security definer:
revoke update on profiles from authenticated;
grant  update (username, unit_size) on profiles to authenticated;

create policy "own bets read"   on tracked_bets    for select to authenticated using (user_id = auth.uid());
create policy "own ledger read" on bankroll_ledger for select to authenticated using (user_id = auth.uid());
-- Sem policy de insert/update/delete: tudo passa por track_prop / untrack_bet / settle_game.

grant select on v_props_board to anon, authenticated;
grant select on v_my_bets     to authenticated;

grant execute on function track_prop(bigint, bet_side, numeric, text) to authenticated;
grant execute on function untrack_bet(uuid) to authenticated;
revoke execute on function settle_game(bigint)     from public, anon, authenticated;
revoke execute on function settle_pending_games()  from public, anon, authenticated;
revoke execute on function refresh_dvp(int)        from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Supabase Realtime: o front assina essas tabelas via WebSocket
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table games, live_player_stats, tracked_bets, prop_analytics, ev_alerts;

-- ---------------------------------------------------------------------
-- pg_cron (habilite em Database > Extensions no Supabase)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule('refresh-dvp',         '10 9 * * *',  $$select refresh_dvp()$$);          -- 06:10 BRT
select cron.schedule('settle-safety-net',   '*/5 * * * *', $$select settle_pending_games()$$);
select cron.schedule('purge-live-stats',    '0 10 * * *',
  $$delete from live_player_stats where updated_at < now() - interval '2 days'$$);
