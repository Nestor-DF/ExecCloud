# ExecCloud — Arquitectura y Documentación Técnica

## Descripción General

**ExecCloud** es una plataforma web que permite subir, gestionar y ejecutar binarios compilados de forma dinámica a través del navegador. Está diseñada para ser completamente genérica: cualquier programa ejecutable puede convertirse en un "servicio" accesible desde la web, sin modificar el código de la aplicación, simplemente proporcionando un binario y un archivo de configuración JSON.

Además, la plataforma soporta el despliegue de **aplicaciones contenerizadas (Docker)**. Se pueden subir aplicaciones web completas empaquetadas en un archivo `.zip` que contenga su propio `Dockerfile` y `docker-compose.yml`, y ExecCloud gestionará su ciclo de vida (Start/Stop) permitiendo acceder a ellas a través de su puerto asignado.

---

## Tecnologías Utilizadas

| Componente       | Tecnología                     | Versión   |
|------------------|--------------------------------|-----------|
| **Runtime**      | Node.js                        | 20+       |
| **Framework**    | Express.js                     | 5.x       |
| **Upload**       | Multer                         | 2.x       |
| **CORS**         | cors                           | 2.x       |
| **Frontend**     | HTML5 + CSS3 + JavaScript (Vanilla) | —    |
| **Tipografía**   | Google Fonts (Inter)           | —         |
| **Contenedor**   | Docker + Docker Compose        | —         |
| **Base image**   | `node:20-bookworm-slim`        | —         |

> No se utiliza ningún framework de frontend (React, Vue, etc.) ni bundler. Todo el frontend es vanilla JS/CSS/HTML servido como archivos estáticos.

---

## Estructura del Proyecto

```
ExecCloud/
├── server.js              # Backend: API REST + ejecución de binarios
├── package.json            # Dependencias Node.js
├── Dockerfile              # Imagen Docker para producción
├── docker-compose.yml      # Orquestación con Docker Compose
├── README.md               # Instrucciones de despliegue
│
├── public/                 # Frontend (archivos estáticos)
│   ├── index.html          # Estructura HTML + modales
│   ├── app.js              # Lógica del cliente (SPA-like)
│   └── styles.css          # Estilos (diseño minimalista B&W)
│
├── services/               # Servicios desplegados (runtime)
│   ├── <nombre_servicio>       # Binario ejecutable
│   ├── <nombre_servicio>.json  # Configuración del servicio
│   └── tmp/                    # Directorio temporal de ejecuciones
│       └── <exec-id>/         # Archivos por ejecución
│
└── samples/                # Ejemplos de servicios
    ├── multiply.json / .cpp
    ├── divide.json / .cpp
    ├── bmi_adjusted.json / .cpp
    ├── filtro_openmp.json / .cpp
    ├── filtro_mpi.json / .cpp
    ├── filtro_cuda.json / .cu
    └── img1.png, img2.png, img3.png   # Imágenes de prueba
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                       NAVEGADOR                         │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  index.html  │  │   app.js     │  │  styles.css  │   │
│  │  (Estructura)│  │  (Lógica)    │  │  (Estilos)   │   │
│  └──────────────┘  └──────┬───────┘  └──────────────┘   │
│                           │                             │
│                    fetch / FormData                     │
└───────────────────────────┼─────────────────────────────┘
                            │ HTTP
┌───────────────────────────┼─────────────────────────────┐
│               SERVER (Node.js + Express)                │
│                           │                             │
│  ┌────────────────────────┼────────────────────────┐    │
│  │               API REST (server.js)              │    │
│  │                                                 │    │
│  │  GET  /api/services        → Lista servicios    │    │
│  │  POST /api/execute/:name   → Ejecuta binario    │    │
│  │  POST /api/upload          → Sube servicio      │    │
│  │  DELETE /api/services/:name → Borra servicio    │    │
│  │  GET  /api/tmp/*           → Sirve outputs      │    │
│  └─────────────────────────────────────────────────┘    │
│                           │                             │
│                 child_process.execFile                  │
│                           │                             │
│  ┌────────────────────────┼────────────────────────┐    │
│  │            SISTEMA DE ARCHIVOS                  │    │
│  │                                                 │    │
│  │  services/                                      │    │
│  │    ├── multiply          (binario ELF)          │    │
│  │    ├── multiply.json     (configuración)        │    │
│  │    └── tmp/                                     │    │
│  │        └── <exec-id>/    (archivos temporales)  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │          WRAPPERS OPCIONALES                    │    │
│  │  mpirun -np N ./binario args...                 │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## API REST

### `GET /api/services`

Devuelve todos los servicios disponibles leyendo los archivos `.json` del directorio `services/`.

**Respuesta:**
```json
{
  "success": true,
  "services": [
    {
      "name": "multiply",
      "description": "Calculates the product of two integers.",
      "args": [...]
    }
  ]
}
```

### `POST /api/execute/:serviceName`

Ejecuta un servicio. Acepta `multipart/form-data` para soportar tanto campos de texto como archivos.

**Flujo de ejecución:**
1. Lee la configuración JSON del servicio
2. Si hay args de tipo `file` u `output_file`, crea un directorio temporal único en `services/tmp/<id>/`
3. Escribe los archivos subidos al directorio temporal
4. Genera rutas temporales para los `output_file`
5. Ensambla el comando: `[wrapper wrapperArgs] binaryPath arg1 arg2 ...`
6. Ejecuta con `child_process.execFile`
7. Devuelve stdout + archivos de salida generados
8. Programa la limpieza automática del directorio temporal

**Respuesta (éxito con archivos de salida):**
```json
{
  "success": true,
  "result": "stdout del programa",
  "stderr": "",
  "outputFiles": [
    {
      "id": "output_image",
      "label": "Output Image",
      "url": "/api/tmp/abc123/output_image.png",
      "mimeType": "image/png",
      "extension": ".png"
    }
  ]
}
```

### `POST /api/upload`

Sube un nuevo servicio. Usa `multipart/form-data` con campos `config` (archivo JSON) y `binary`.
- **Para binarios normales:** Automáticamente establece permisos de ejecución (`chmod 755`) en el binario.
- **Para aplicaciones Docker:** Se espera que `binary` sea un archivo `.zip` con el código fuente, incluyendo `Dockerfile` y `docker-compose.yml`. El backend lo extraerá automáticamente en el directorio del servicio.

### `DELETE /api/services/:serviceName`

Elimina un servicio. Si es de tipo Docker, primero ejecuta `docker compose down` para detener los contenedores antes de borrar los archivos (binario/directorio y archivo JSON).

### `GET /api/tmp/*`

Ruta estática que sirve archivos de salida temporales para que el frontend pueda descargarlos o mostrarlos.

### `POST /api/docker/:serviceName/up`

Inicia una aplicación contenerizada utilizando `docker compose up -d --build`. Sólo aplicable si el servicio tiene `"type": "docker"` en su configuración JSON.

### `POST /api/docker/:serviceName/down`

Detiene una aplicación contenerizada utilizando `docker compose down`.

---

## Formato de Configuración de Servicios (JSON)

Cada servicio se define con un archivo `.json` cuyo nombre debe coincidir con el nombre del binario.

### Estructura completa

```json
{
  "name": "nombre_servicio",
  "description": "Descripción legible del servicio",
  "timeout": 60,
  "execution": {
    "wrapper": "mpirun",
    "wrapperArgs": ["-np", "4"]
  },
  "args": [
    {
      "id": "identificador_unico",
      "label": "Etiqueta visible en la UI",
      "type": "text | number | file | output_file",
      "accept": "image/*",
      "extension": ".png",
      "arg_description": "Texto descriptivo mostrado como tooltip"
    }
  ]
}
```

### Campos del servicio

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `name` | Sí | Identificador único, debe coincidir con el nombre del binario |
| `description` | Sí | Descripción mostrada en la interfaz |
| `type` | No | Define el tipo de servicio. Valor por defecto: (vacío, binario). Usar `"docker"` para aplicaciones contenerizadas. |
| `port` | No | Obligatorio si `type` es `"docker"`. Puerto en el que la aplicación mapeará su salida para que el usuario pueda acceder (ej: `3000`). |
| `args` | Sí | Array de definiciones de argumentos (puede estar vacío). No aplica para servicios `"docker"`. |
| `timeout` | No | Timeout en segundos (default: 30) |
| `execution` | No | Configuración del wrapper de ejecución |

### Tipos de argumentos

| Tipo | Input en UI | Se pasa al binario como |
|------|-------------|------------------------|
| `text` | Campo de texto | Valor como string |
| `number` | Campo numérico | Valor como string |
| `file` | Upload de archivo | Ruta al archivo temporal |
| `output_file` | Auto-generado (no visible al usuario) | Ruta temporal donde el binario escribe la salida |

### Campos de cada argumento

| Campo | Requerido | Aplica a | Descripción |
|-------|-----------|----------|-------------|
| `id` | Sí | Todos | Identificador único del argumento |
| `label` | Sí | Todos | Etiqueta mostrada en la UI |
| `type` | Sí | Todos | Tipo: `text`, `number`, `file`, `output_file` |
| `accept` | No | `file` | Filtro MIME para el input (ej: `image/*`) |
| `extension` | No | `output_file` | Extensión del archivo de salida (ej: `.png`) |
| `arg_description` | No | Todos | Texto tooltip con información adicional |

### Wrapper de ejecución

Permite ejecutar el binario a través de un comando wrapper como `mpirun`:

```json
"execution": {
  "wrapper": "mpirun",
  "wrapperArgs": ["-np", "4"]
}
```

Comando resultante: `mpirun -np 4 ./services/filtro_mpi <arg1> <arg2> ...`

---

## Frontend

### Diseño

- **Estilo**: Minimalista, blanco y negro, tipografía Inter
- **Responsive**: Grid CSS con `auto-fill` y `minmax`, adaptable a cualquier pantalla
- **Sin frameworks**: HTML + CSS + JS vanilla

### Componentes principales

1. **Grid de servicios**: Tarjetas preview con nombre, descripción y tags de tipos de argumento. Click para abrir modal.
2. **Barra de búsqueda**: Filtra servicios por nombre y descripción (búsqueda por palabras, todas deben coincidir).
3. **Paginación**: Navegación por páginas (12 servicios por página).
4. **Modal de ejecución**: Formulario dinámico generado según la configuración del servicio. Soporta inputs de texto, numéricos, uploads de archivo con drag-and-drop, y badges informativos para output files. Muestra resultados inline (stdout como texto, imágenes como preview, video/audio con player, otros como descarga).
   - Para servicios **Docker**: Muestra una interfaz especial con controles "Start App" y "Stop App", así como un botón "Open Application" que redirige al puerto del servicio.
5. **Modal de upload**: Formulario para subir nuevos servicios con ayuda integrada (panel colapsable con documentación del formato JSON).
6. **Tooltips**: Los argumentos con `arg_description` muestran un icono ⓘ con tooltip CSS al pasar el cursor.

### Flujo de ejecución (desde el frontend)

```
Usuario abre tarjeta → Modal con formulario dinámico
  → Rellena campos (texto, número, archivos)
  → Click "Execute"
  → FormData enviado a POST /api/execute/:name
  → Respuesta JSON con stdout + outputFiles
  → Renderiza: texto en caja, imágenes inline, descargas
```

---

## Cómo añadir un nuevo servicio

1. Compilar el binario para la arquitectura del host/contenedor
2. Crear el archivo `.json` de configuración con el mismo nombre
3. Opciones para desplegarlo:
   - **UI**: Usar el botón "Add New Service" y subir ambos archivos
   - **Manual**: Copiar ambos archivos al directorio `services/` y asignar permisos de ejecución al binario (`chmod +x`)

### Ejemplo: servicio de multiplicación

**`multiply.json`:**
```json
{
  "name": "multiply",
  "description": "Calculates the product of two integers.",
  "args": [
    { "id": "a", "label": "First Number", "type": "number" },
    { "id": "b", "label": "Second Number", "type": "number" }
  ]
}
```

**Uso equivalente en terminal:**
```bash
./multiply 5 3
# Output: 15
```

### Ejemplo: filtro de imagen con CUDA

**`filtro_cuda.json`:**
```json
{
  "name": "filtro_cuda",
  "description": "Applies a bilateral filter using CUDA GPU acceleration.",
  "timeout": 60,
  "args": [
    { "id": "input_image", "label": "Input Image", "type": "file", "accept": "image/*" },
    { "id": "output_image", "label": "Output Image", "type": "output_file", "extension": ".png" },
    { "id": "blockX", "label": "Block X", "type": "number", "arg_description": "Threads per block in X dimension." },
    { "id": "blockY", "label": "Block Y", "type": "number", "arg_description": "Threads per block in Y dimension." }
  ]
}
```

**Uso equivalente en terminal:**
```bash
./filtro_cuda entrada.png salida.png 16 16
```

### Ejemplo: Aplicación Web con Docker

**`webapp.json`:**
```json
{
  "name": "webapp",
  "description": "Servicio web contenerizado con Node.js",
  "type": "docker",
  "port": 3000,
  "args": []
}
```

El archivo `binary` subido debe ser un `.zip` que contenga en su raíz:
- `Dockerfile`
- `docker-compose.yml` (donde exponga el puerto 3000 a través de `ports: ["3000:3000"]`)
- Código fuente de la aplicación (ej. `package.json`, `index.js`).

---

## Gestión de Archivos Temporales

Cada ejecución que involucra archivos (`file` o `output_file`) crea un directorio temporal único:

```
services/tmp/<random-hex-id>/
  ├── input_image.png       ← archivo subido por el usuario
  └── output_image.png      ← archivo generado por el binario
```

- **Limpieza automática**: Los directorios temporales se eliminan automáticamente:
  - **5 segundos** después si no hay archivos de salida
  - **5 minutos** después si hay archivos de salida (para permitir la descarga)
- Los archivos de salida se sirven vía `/api/tmp/<id>/<filename>`
