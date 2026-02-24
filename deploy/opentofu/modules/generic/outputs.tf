output "inventory_path" {
  description = "Absolute path to the generated Ansible inventory file"
  value       = abspath(local_file.ansible_inventory.filename)
}
