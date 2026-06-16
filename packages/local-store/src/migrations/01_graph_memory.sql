-- Graph memory index migration (Phase 1)
-- Ensure composite indexes for graph nodes and edges even after initTables runs.

CREATE INDEX IF NOT EXISTS idx_graph_nodes_workspace_type
  ON memory_graph_nodes(workspace_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source_target_relation
  ON memory_graph_edges(source_id, target_id, relation_type);
