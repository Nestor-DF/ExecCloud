#include <png++/png.hpp>

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <cstdlib>

using namespace std;
using namespace chrono;

typedef vector<double> Array;
typedef vector<Array> Matrix;
typedef vector<Matrix> Image;

// c -> capa (por ejemplo, canal en una imagen RGB)
// y -> fila
// x -> columna
// height * width -> tamaño de una capa
static inline int idx3_host(int c, int y, int x, int height, int width)
{
    return c * height * width + y * width + x;
}

__device__ int idx3_dev(int c, int y, int x, int height, int width)
{
    return c * height * width + y * width + x;
}

Image loadImage(const char *filename)
{
    png::image<png::rgb_pixel> image(filename);
    Image imageMatrix(3, Matrix(image.get_height(), Array(image.get_width())));

    for (int h = 0; h < (int)image.get_height(); h++)
    {
        for (int w = 0; w < (int)image.get_width(); w++)
        {
            imageMatrix[0][h][w] = image[h][w].red;
            imageMatrix[1][h][w] = image[h][w].green;
            imageMatrix[2][h][w] = image[h][w].blue;
        }
    }

    return imageMatrix;
}

void saveImage(const Image &image, const string &filename)
{
    assert(image.size() == 3);

    int height = (int)image[0].size();
    int width = (int)image[0][0].size();
    png::image<png::rgb_pixel> imageFile(width, height);

    for (int y = 0; y < height; y++)
    {
        for (int x = 0; x < width; x++)
        {
            imageFile[y][x].red = (uint8_t)round(max(0.0, min(255.0, image[0][y][x])));
            imageFile[y][x].green = (uint8_t)round(max(0.0, min(255.0, image[1][y][x])));
            imageFile[y][x].blue = (uint8_t)round(max(0.0, min(255.0, image[2][y][x])));
        }
    }
    imageFile.write(filename);
}

vector<double> flattenImage(const Image &image)
{
    int height = (int)image[0].size();
    int width = (int)image[0][0].size();
    vector<double> flat(3 * height * width);

    for (int c = 0; c < 3; ++c)
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x)
                flat[idx3_host(c, y, x, height, width)] = image[c][y][x];

    return flat;
}

Image unflattenImage(const vector<double> &flat, int height, int width)
{
    Image image(3, Matrix(height, Array(width)));

    for (int c = 0; c < 3; ++c)
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x)
                image[c][y][x] = flat[idx3_host(c, y, x, height, width)];

    return image;
}

__global__ void bilateralKernel(const double *input, double *output,
                                int height, int width,
                                int filterSize, double sigmaSpace, double sigmaColor)
{
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    int c = blockIdx.z;

    if (x >= width || y >= height || c >= 3)
        return;

    int radius = filterSize / 2;
    double norm = 0.0;
    double acc = 0.0;
    double center = input[idx3_dev(c, y, x, height, width)];

    for (int dy = -radius; dy <= radius; ++dy)
    {
        for (int dx = -radius; dx <= radius; ++dx)
        {
            int ny = y + dy;
            int nx = x + dx;

            if (ny >= 0 && ny < height && nx >= 0 && nx < width)
            {
                double spatialDist2 = (double)(dy * dy + dx * dx);
                double neighbor = input[idx3_dev(c, ny, nx, height, width)];
                double colorDist = neighbor - center;

                double spatialWeight = exp(-spatialDist2 / (2.0 * sigmaSpace * sigmaSpace));
                double colorWeight = exp(-(colorDist * colorDist) / (2.0 * sigmaColor * sigmaColor));
                double weight = spatialWeight * colorWeight;

                acc += weight * neighbor;
                norm += weight;
            }
        }
    }

    output[idx3_dev(c, y, x, height, width)] = (norm > 0.0) ? (acc / norm) : center;
}

int main(int argc, char *argv[])
{
    if (argc < 5)
    {
        cerr << "Uso: ./filtro_cuda entrada.png salida.png blockX blockY\n";
        return 1;
    }

    int blockX = atoi(argv[3]);
    int blockY = atoi(argv[4]);

    if (blockX <= 0 || blockY <= 0)
    {
        cerr << "Error: blockX y blockY deben ser enteros positivos.\n";
        return 1;
    }

    if (blockX * blockY > 1024)
    {
        cerr << "Error: blockX * blockY no puede ser mayor que 1024.\n";
        return 1;
    }

    auto t1 = high_resolution_clock::now();

    cout << "Loading image..." << endl;
    Image image = loadImage(argv[1]);
    int height = (int)image[0].size();
    int width = (int)image[0][0].size();

    vector<double> hostInput = flattenImage(image);
    vector<double> hostOutput(3 * height * width);

    cout << "Applying filter..." << endl;
    auto t1_1 = high_resolution_clock::now();

    const int filterSize = 11;
    const double sigmaSpace = 5.0;
    const double sigmaColor = 25.0;

    double *d_input = nullptr;
    double *d_output = nullptr;
    size_t bytes = hostInput.size() * sizeof(double);

    cudaMalloc(&d_input, bytes);
    cudaMalloc(&d_output, bytes);

    cudaMemcpy(d_input, hostInput.data(), bytes, cudaMemcpyHostToDevice);

    dim3 block(blockX, blockY, 1);
    dim3 grid((width + block.x - 1) / block.x,
              (height + block.y - 1) / block.y,
              3);

    cout << "CUDA block size: (" << blockX << ", " << blockY << ")" << endl;
    cout << "CUDA grid size: (" << grid.x << ", " << grid.y << ", " << grid.z << ")" << endl;

    bilateralKernel<<<grid, block>>>(d_input, d_output, height, width,
                                     filterSize, sigmaSpace, sigmaColor);

    cudaDeviceSynchronize();

    cudaMemcpy(hostOutput.data(), d_output, bytes, cudaMemcpyDeviceToHost);

    cudaFree(d_input);
    cudaFree(d_output);

    auto t2_1 = high_resolution_clock::now();
    auto duration_1 = duration_cast<milliseconds>(t2_1 - t1_1).count();
    cout << "Tiempo de cómputo: " << (float)(duration_1 / 1000.0) << " sec" << endl;

    cout << "Saving image..." << endl;
    Image newImage = unflattenImage(hostOutput, height, width);
    saveImage(newImage, argv[2]);

    cout << "Done!" << endl;

    auto t2 = high_resolution_clock::now();
    auto duration = duration_cast<milliseconds>(t2 - t1).count();
    cout << "Tiempo de ejecucion: " << (float)(duration / 1000.0) << " sec" << endl;

    return 0;
}