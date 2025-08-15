-- Create new tables with namespace support
CREATE TABLE `nodes_new` (
  `id` text PRIMARY KEY NOT NULL,
  `namespace` text NOT NULL,
  `parent_id` text,
  `kind` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `order_key` text
);

CREATE TABLE `operations_new` (
  `id` text PRIMARY KEY NOT NULL,
  `namespace` text NOT NULL,
  `type` text NOT NULL,
  `node_id` text NOT NULL,
  `data` text,
  `timestamp` integer NOT NULL,
  `device_id` text,
  `session_id` text
);

CREATE TABLE `sync_metadata_new` (
  `id` text PRIMARY KEY NOT NULL,
  `namespace` text NOT NULL,
  `last_sync_timestamp` integer,
  `last_operation_id` text,
  `device_id` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1
);

CREATE TABLE `tree_snapshots_new` (
  `id` text PRIMARY KEY NOT NULL,
  `namespace` text NOT NULL,
  `root_id` text NOT NULL,
  `data` text NOT NULL,
  `timestamp` integer NOT NULL,
  `version` integer NOT NULL
);

-- Copy data from old tables with default namespace 'default'
INSERT INTO `nodes_new` (`id`, `namespace`, `parent_id`, `kind`, `created_at`, `updated_at`, `order_key`)
SELECT `id`, 'default', `parent_id`, `kind`, `created_at`, `updated_at`, `order_key` FROM `nodes`;

INSERT INTO `operations_new` (`id`, `namespace`, `type`, `node_id`, `data`, `timestamp`, `device_id`, `session_id`)
SELECT `id`, 'default', `type`, `node_id`, `data`, `timestamp`, `device_id`, `session_id` FROM `operations`;

INSERT INTO `sync_metadata_new` (`id`, `namespace`, `last_sync_timestamp`, `last_operation_id`, `device_id`, `version`)
SELECT `id`, 'default', `last_sync_timestamp`, `last_operation_id`, `device_id`, `version` FROM `sync_metadata`;

INSERT INTO `tree_snapshots_new` (`id`, `namespace`, `root_id`, `data`, `timestamp`, `version`)
SELECT `id`, 'default', `root_id`, `data`, `timestamp`, `version` FROM `tree_snapshots`;

-- Drop old tables
DROP TABLE `nodes`;
DROP TABLE `operations`;
DROP TABLE `sync_metadata`;
DROP TABLE `tree_snapshots`;

-- Rename new tables to original names
ALTER TABLE `nodes_new` RENAME TO `nodes`;
ALTER TABLE `operations_new` RENAME TO `operations`;
ALTER TABLE `sync_metadata_new` RENAME TO `sync_metadata`;
ALTER TABLE `tree_snapshots_new` RENAME TO `tree_snapshots`;
