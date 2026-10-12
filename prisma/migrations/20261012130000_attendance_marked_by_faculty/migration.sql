-- Flags attendance rows a faculty/admin marked present manually (device issue),
-- so they can be listed/filtered/exported. Additive: existing rows default to 0.
ALTER TABLE `attendance`
  ADD COLUMN `marked_by_faculty` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `marked_by_roll` VARCHAR(191) NULL,
  ADD COLUMN `marked_at` DATETIME(3) NULL;

CREATE INDEX `attendance_marked_by_faculty_idx` ON `attendance`(`marked_by_faculty`);
