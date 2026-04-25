#include <iostream>
#include <vector>
#include <assert.h>
#include <cmath>
#include <png++/png.hpp>
#include "stdio.h"
#include "string.h"
#include <string>
#include <sstream>
#include <chrono>
#include <omp.h>

using namespace std;
using namespace chrono;

typedef vector<double> Array;
typedef vector<Array> Matrix;
typedef vector<Matrix> Image;

Image loadImage(const char *filename)
{
    png::image<png::rgb_pixel> image(filename);
    Image imageMatrix(3, Matrix(image.get_height(), Array(image.get_width())));

    int h, w;
    for (h = 0; h < (int)image.get_height(); h++)
    {
        for (w = 0; w < (int)image.get_width(); w++)
        {
            imageMatrix[0][h][w] = image[h][w].red;
            imageMatrix[1][h][w] = image[h][w].green;
            imageMatrix[2][h][w] = image[h][w].blue;
        }
    }

    return imageMatrix;
}

void saveImage(Image &image, string filename)
{
    assert(image.size() == 3);

    int height = image[0].size();
    int width = image[0][0].size();
    int x, y;

    png::image<png::rgb_pixel> imageFile(width, height);

    for (y = 0; y < height; y++)
    {
        for (x = 0; x < width; x++)
        {
            imageFile[y][x].red = image[0][y][x];
            imageFile[y][x].green = image[1][y][x];
            imageFile[y][x].blue = image[2][y][x];
        }
    }
    imageFile.write(filename);
}

Image applyBilateralFilter(Image &image, int filterSize, double sigmaSpace, double sigmaColor)
{
    assert(image.size() == 3);

    int height = image[0].size();
    int width = image[0][0].size();
    int radius = filterSize / 2;

    Image newImage(3, Matrix(height, Array(width, 0.0)));

    #pragma omp parallel for collapse(3) schedule(static)
    for (int d = 0; d < 3; d++)
    {
        for (int i = 0; i < height; i++)
        {
            for (int j = 0; j < width; j++)
            {
                double norm = 0.0;
                double acc = 0.0;
                double center = image[d][i][j];

                for (int di = -radius; di <= radius; di++)
                {
                    for (int dj = -radius; dj <= radius; dj++)
                    {
                        int ni = i + di;
                        int nj = j + dj;

                        if (ni >= 0 && ni < height && nj >= 0 && nj < width)
                        {
                            double spatialDist2 = di * di + dj * dj;
                            double colorDist = image[d][ni][nj] - center;

                            double spatialWeight = exp(-spatialDist2 / (2.0 * sigmaSpace * sigmaSpace));
                            double colorWeight = exp(-(colorDist * colorDist) / (2.0 * sigmaColor * sigmaColor));

                            double weight = spatialWeight * colorWeight;

                            acc += weight * image[d][ni][nj];
                            norm += weight;
                        }
                    }
                }

                newImage[d][i][j] = (norm > 0.0) ? (acc / norm) : center;
            }
        }
    }

    return newImage;
}

int main(int argc, char *argv[])
{
    if (argc < 3)
    {
        cerr << "Uso: ./filtro_openmp entrada.png salida.png\n";
        return 1;
    }

    auto t1 = high_resolution_clock::now();

    cout << "Loading image..." << endl;
    Image image = loadImage(argv[1]);
    cout << "Applying filter..." << endl;

    auto t1_1 = high_resolution_clock::now();

    Image newImage = applyBilateralFilter(image, 11, 5.0, 25.0);

    auto t2_1 = high_resolution_clock::now();
    auto duration_1 = duration_cast<milliseconds>(t2_1 - t1_1).count();
    cout << "Tiempo de cómputo: " << (float)(duration_1 / 1000.0) << " sec" << endl;

    cout << "Saving image..." << endl;

    stringstream ss;
    ss << argv[2];
    string ficheroGuardar = ss.str();

    saveImage(newImage, ficheroGuardar);
    cout << "Done!" << endl;

    auto t2 = high_resolution_clock::now();
    auto duration = duration_cast<milliseconds>(t2 - t1).count();
    cout << "Tiempo de ejecucion: " << (float)(duration / 1000.0) << " sec" << endl;

    return 0;
}
