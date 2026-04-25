#include <mpi.h>
#include <png++/png.hpp>

#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using namespace std;
using namespace chrono;

typedef vector<double> Array;
typedef vector<Array> Matrix;
typedef vector<Matrix> Image;

// Layout por filas: [y][x][c]
static inline int idx3(int y, int x, int c, int width)
{
    return (y * width + x) * 3 + c;
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
    vector<double> flat(height * width * 3);

    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x)
            for (int c = 0; c < 3; ++c)
                flat[idx3(y, x, c, width)] = image[c][y][x];

    return flat;
}

Image unflattenImage(const vector<double> &flat, int height, int width)
{
    Image image(3, Matrix(height, Array(width)));

    for (int y = 0; y < height; ++y)
        for (int x = 0; x < width; ++x)
            for (int c = 0; c < 3; ++c)
                image[c][y][x] = flat[idx3(y, x, c, width)];

    return image;
}

void computeCountsAndDispls(int totalRows, int width, int worldSize,
                            vector<int> &counts, vector<int> &displs)
{
    counts.resize(worldSize);
    displs.resize(worldSize);

    int base = totalRows / worldSize;
    int rem = totalRows % worldSize;
    int offsetRows = 0;

    for (int r = 0; r < worldSize; ++r)
    {
        int rows = base + (r < rem ? 1 : 0);
        counts[r] = rows * width * 3;
        displs[r] = offsetRows * width * 3;
        offsetRows += rows;
    }
}

vector<double> applyBilateralLocal(const vector<double> &localWithHalo,
                                   int localRows,
                                   int haloTop,
                                   int haloBottom,
                                   int width,
                                   int filterSize,
                                   double sigmaSpace,
                                   double sigmaColor)
{
    int radius = filterSize / 2;
    int extendedRows = localRows + haloTop + haloBottom;
    vector<double> out(localRows * width * 3, 0.0);

    for (int i = 0; i < localRows; ++i)
    {
        int li = i + haloTop;
        for (int j = 0; j < width; ++j)
        {
            for (int c = 0; c < 3; ++c)
            {
                double norm = 0.0;
                double acc = 0.0;
                double center = localWithHalo[idx3(li, j, c, width)];

                for (int di = -radius; di <= radius; ++di)
                {
                    for (int dj = -radius; dj <= radius; ++dj)
                    {
                        int ni = li + di;
                        int nj = j + dj;

                        if (ni >= 0 && ni < extendedRows && nj >= 0 && nj < width)
                        {
                            double spatialDist2 = di * di + dj * dj;
                            double neighbor = localWithHalo[idx3(ni, nj, c, width)];
                            double colorDist = neighbor - center;

                            double spatialWeight = exp(-spatialDist2 / (2.0 * sigmaSpace * sigmaSpace));
                            double colorWeight = exp(-(colorDist * colorDist) / (2.0 * sigmaColor * sigmaColor));
                            double weight = spatialWeight * colorWeight;

                            acc += weight * neighbor;
                            norm += weight;
                        }
                    }
                }

                out[idx3(i, j, c, width)] = (norm > 0.0) ? (acc / norm) : center;
            }
        }
    }

    return out;
}

int main(int argc, char *argv[])
{
    MPI_Init(&argc, &argv);

    int rank, worldSize;
    MPI_Comm_rank(MPI_COMM_WORLD, &rank);
    MPI_Comm_size(MPI_COMM_WORLD, &worldSize);

    if (argc < 3)
    {
        if (rank == 0)
            cerr << "Uso: mpirun -np 4 ./filtro_mpi entrada.png salida.png\n";
        MPI_Finalize();
        return 1;
    }

    auto t1 = high_resolution_clock::now();

    int height = 0, width = 0;
    vector<double> fullImageFlat;

    const int filterSize = 11;
    const int radius = filterSize / 2;
    const double sigmaSpace = 5.0;
    const double sigmaColor = 25.0;

    if (rank == 0)
    {
        cout << "Loading image..." << endl;
        Image image = loadImage(argv[1]);
        height = (int)image[0].size();
        width = (int)image[0][0].size();
        fullImageFlat = flattenImage(image);
    }

    MPI_Bcast(&height, 1, MPI_INT, 0, MPI_COMM_WORLD);
    MPI_Bcast(&width, 1, MPI_INT, 0, MPI_COMM_WORLD);

    vector<int> counts, displs;
    computeCountsAndDispls(height, width, worldSize, counts, displs);

    int localCount = counts[rank];
    int localRows = (width > 0) ? localCount / (width * 3) : 0;

    int startRow = 0;
    for (int r = 0; r < rank; ++r)
        startRow += counts[r] / (width * 3);

    int haloTop = min(radius, startRow);
    int haloBottom = min(radius, height - (startRow + localRows));
    int extendedRows = localRows + haloTop + haloBottom;

    vector<double> localWithHalo(extendedRows * width * 3);

    if (rank == 0)
        cout << "Applying filter..." << endl;

    MPI_Barrier(MPI_COMM_WORLD);
    auto t1_1 = high_resolution_clock::now();

    if (rank == 0)
    {
        for (int r = 0; r < worldSize; ++r)
        {
            int rRows = counts[r] / (width * 3);
            int rStart = 0;
            for (int k = 0; k < r; ++k)
                rStart += counts[k] / (width * 3);

            int rHaloTop = min(radius, rStart);
            int rHaloBottom = min(radius, height - (rStart + rRows));
            int rExtendedRows = rRows + rHaloTop + rHaloBottom;
            int sourceStartRow = rStart - rHaloTop;

            vector<double> tmp(rExtendedRows * width * 3);
            int sourceOffset = sourceStartRow * width * 3;
            int numElems = rExtendedRows * width * 3;
            copy(fullImageFlat.begin() + sourceOffset,
                 fullImageFlat.begin() + sourceOffset + numElems,
                 tmp.begin());

            if (r == 0)
            {
                localWithHalo = std::move(tmp);
            }
            else
            {
                int tmpSize = (int)tmp.size();
                MPI_Send(&tmpSize, 1, MPI_INT, r, 0, MPI_COMM_WORLD);
                MPI_Send(tmp.data(), tmpSize, MPI_DOUBLE, r, 1, MPI_COMM_WORLD);
            }
        }
    }
    else
    {
        int recvSize = 0;
        MPI_Recv(&recvSize, 1, MPI_INT, 0, 0, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
        localWithHalo.resize(recvSize);
        MPI_Recv(localWithHalo.data(), recvSize, MPI_DOUBLE, 0, 1, MPI_COMM_WORLD, MPI_STATUS_IGNORE);
    }

    vector<double> localResult = applyBilateralLocal(localWithHalo, localRows, haloTop, haloBottom, width,
                                                     filterSize, sigmaSpace, sigmaColor);

    vector<double> gathered;
    if (rank == 0)
        gathered.resize(height * width * 3);

    MPI_Gatherv(localResult.data(), (int)localResult.size(), MPI_DOUBLE,
                rank == 0 ? gathered.data() : nullptr, counts.data(), displs.data(), MPI_DOUBLE,
                0, MPI_COMM_WORLD);

    MPI_Barrier(MPI_COMM_WORLD);
    auto t2_1 = high_resolution_clock::now();

    if (rank == 0)
    {
        auto duration_1 = duration_cast<milliseconds>(t2_1 - t1_1).count();
        cout << "Tiempo de cómputo: " << (float)(duration_1 / 1000.0) << " sec" << endl;
        cout << "Saving image..." << endl;
        Image newImage = unflattenImage(gathered, height, width);
        saveImage(newImage, argv[2]);
        cout << "Done!" << endl;

        auto t2 = high_resolution_clock::now();
        auto duration = duration_cast<milliseconds>(t2 - t1).count();
        cout << "Tiempo de ejecucion: " << (float)(duration / 1000.0) << " sec" << endl;
    }

    MPI_Finalize();
    return 0;
}
