output "server_ip" {
  description = "Public IPv4 address of the server"
  value       = hcloud_server.main.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 network of the server"
  value       = hcloud_server.main.ipv6_network
}

output "server_id" {
  description = "Hetzner Cloud server ID"
  value       = hcloud_server.main.id
}

output "server_name" {
  description = "Name of the server"
  value       = hcloud_server.main.name
}

output "server_status" {
  description = "Current status of the server"
  value       = hcloud_server.main.status
}
