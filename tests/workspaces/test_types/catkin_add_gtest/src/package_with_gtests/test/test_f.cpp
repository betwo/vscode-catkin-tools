#include <gtest/gtest.h>

class Fixture : public ::testing::Test
{
};

TEST_F(Fixture, DoesBlah)
{
    SUCCEED();
}

TEST_F(Fixture, HasPropertyA)
{
    SUCCEED();
}