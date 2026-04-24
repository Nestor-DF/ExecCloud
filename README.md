# ExecCloud

Esta es una plataforma web que permite descubrir y ejecutar dinámicamente servicios basados en archivos binarios.

## Despliegue y Uso

### Con Docker Compose (recomendado)

La forma más sencilla de ejecutar la aplicación es mediante Docker Compose:

1. **Construir y levantar el contenedor:**
   ```bash
   docker compose up --build
   ```

2. **Acceder a la aplicación:**
   Abre tu navegador web y ve a la siguiente dirección:
   [http://localhost:3000](http://localhost:3000)

> Los servicios (binarios y configuraciones `.json`) se persisten en el directorio `./services` de la máquina host mediante un volumen Docker.

Para detener la aplicación:
```bash
docker compose down
```

---

### Ejecución local (sin Docker)

1. **Instalar las dependencias de Node.js:**
   ```bash
   npm install
   ```

2. **Ejecutar el servidor:**
   ```bash
   node server.js
   ```

3. **Acceder a la aplicación:**
   Abre tu navegador web y ve a la siguiente dirección:
   [http://localhost:3000](http://localhost:3000)
