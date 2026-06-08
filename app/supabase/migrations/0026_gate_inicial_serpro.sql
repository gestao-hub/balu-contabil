-- @custom — Gate inicial SERPRO: rastreia quando a empresa Simples fez o primeiro sync.
-- NULL = nunca sincronizou → exibe GateInicialSerpro na página /impostos.
-- NOT NULL = já sincronizou → exibe a página normal.
-- Sem default intencional: empresas existentes ficam NULL, ativando o gate na próxima visita.
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS sincronizacao_inicial_serpro_at TIMESTAMPTZ;
