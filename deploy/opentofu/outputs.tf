output "server_ip" {
  description = "Public IPv4 address of the provisioned server"
  value       = module.hetzner.server_ip
}

output "server_id" {
  description = "Hetzner Cloud server ID"
  value       = module.hetzner.server_id
}

output "inventory_path" {
  description = "Path to the generated Ansible inventory file"
  value       = module.inventory.inventory_path
}

output "ssh_connection" {
  description = "SSH command to connect to the server as the deploy user"
  value       = "ssh deploy@${module.hetzner.server_ip}"
}

output "dns_instructions" {
  description = "DNS record to create for the domain"
  value       = "Create an A record: ${var.domain} -> ${module.hetzner.server_ip}"
}
