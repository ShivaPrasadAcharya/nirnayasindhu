---
layout: null
---
[
{% assign cause_file_found = false %}
{% for file in site.static_files %}
  {% assign cause_prefix = file.name | slice: 0, 5 %}
  {% assign cause_name_size = file.name | size %}
  {% if cause_prefix == "index" and file.extname == ".html" and cause_name_size == 18 %}
    {% if cause_file_found %},{% endif %}"{{ file.name }}"
    {% assign cause_file_found = true %}
  {% endif %}
{% endfor %}
]
