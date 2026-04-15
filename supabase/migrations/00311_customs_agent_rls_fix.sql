-- ─── Restrict Customs Agent View to Assigned Shipments ──────────────────────
-- Previously customs agents could see all containers in waiting_customs_review status.
-- Now they can ONLY see containers in shipments where customs_agent_id matches their user ID.

-- Drop the old overly-permissive customs agent container policy
DROP POLICY IF EXISTS "customs_agents_read_containers_in_review" ON portix.containers;

-- Create new restrictive policy: customs agent can only see containers in their assigned shipments
CREATE POLICY "customs_agents_read_assigned_containers"
  ON portix.containers
  FOR SELECT
  USING (
    -- User must be authenticated
    auth.uid() IS NOT NULL
    AND
    -- User must have customs_agent role
    (SELECT role FROM portix.profiles WHERE id = auth.uid()) = 'customs_agent'
    AND
    -- Container's shipment must be assigned to this user
    (SELECT customs_agent_id FROM portix.shipments WHERE id = shipment_id) = auth.uid()
  );

-- Customs agents can also still update/reject documents for their assigned containers
DROP POLICY IF EXISTS "customs_agents_manage_documents" ON portix.documents;

CREATE POLICY "customs_agents_manage_assigned_documents"
  ON portix.documents
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND (SELECT role FROM portix.profiles WHERE id = auth.uid()) = 'customs_agent'
    AND (
      SELECT customs_agent_id
      FROM portix.shipments
      WHERE id = (SELECT shipment_id FROM portix.containers WHERE id = container_id)
    ) = auth.uid()
  );

-- Customs agents can also read documents in their assigned containers
DROP POLICY IF EXISTS "customs_agents_read_documents" ON portix.documents;

CREATE POLICY "customs_agents_read_assigned_documents"
  ON portix.documents
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (SELECT role FROM portix.profiles WHERE id = auth.uid()) = 'customs_agent'
    AND (
      SELECT customs_agent_id
      FROM portix.shipments
      WHERE id = (SELECT shipment_id FROM portix.containers WHERE id = container_id)
    ) = auth.uid()
  );
